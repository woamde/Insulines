import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from pymongo.errors import DuplicateKeyError
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from account_lifecycle import account_gate

logger = logging.getLogger(__name__)

SESSION_TTL_DAYS = 7
SESSION_AUTH_LOG_MESSAGE = "Connexion Google demandée — UA=%s"

# Nécessaires pour échanger un "code" d'autorisation OAuth2 contre un vrai
# id_token/access_token. À définir dans ton .env. GOOGLE_REDIRECT_URI doit
# correspondre EXACTEMENT (schéma, port, chemin) à ce qui est enregistré dans
# Google Cloud Console ET à ce que le frontend utilise pour démarrer le flux.
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "")

# ⚠️ PROBLÈME CONNU, PAS ENCORE CORRIGÉ : _db reste à None tant que init_auth(db)
# n'est jamais appelé quelque part au démarrage avec une vraie connexion MongoDB
# (motor). Tant que ce n'est pas fait, persist_session() plantera avec
# AttributeError: 'NoneType' object has no attribute 'users'.
_db = None


def init_auth(db):
    global _db
    _db = db


async def ensure_indexes():
    await _db.users.create_index("email", unique=True)
    await _db.users.create_index("user_id", unique=True)
    await _db.user_sessions.create_index("session_token", unique=True)
    await _db.user_sessions.create_index("user_id")
    await _db.user_sessions.create_index("expires_at", expireAfterSeconds=0)


class SessionCreate(BaseModel):
    session_id: str


async def resolve_current_user(request: Request, authorization: Optional[str], user_agent: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        logger.warning("401 sans jeton — %s %s UA=%s", request.method, request.url.path, (user_agent or "?")[:120])
        raise HTTPException(status_code=401, detail="Non authentifié")
    token = authorization.split(" ", 1)[1].strip()
    session = await _db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        logger.warning("401 session inconnue — %s %s UA=%s", request.method, request.url.path, (user_agent or "?")[:120])
        raise HTTPException(status_code=401, detail="Session invalide")
    expires = session.get("expires_at")
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            logger.warning("401 session expirée — %s %s user=%s", request.method, request.url.path, session.get("user_id"))
            raise HTTPException(status_code=401, detail="Session expirée")
    user = await _db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        logger.warning("401 utilisateur introuvable — %s %s user=%s", request.method, request.url.path, session.get("user_id"))
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")
    return user


async def get_current_user(request: Request, authorization: Optional[str] = Header(None), user_agent: Optional[str] = Header(None)):
    user = await resolve_current_user(request, authorization, user_agent)
    erasing = request.method == "DELETE" and request.url.path.rstrip("/") == "/api/auth/account"
    async with account_gate(user["user_id"]).access(erase=erasing):
        user = await resolve_current_user(request, authorization, user_agent)
        if user.get("account_deletion_pending") and not erasing and request.url.path.rstrip("/") != "/api/auth/me":
            raise HTTPException(status_code=409, detail="Suppression à terminer depuis l'écran Supprimer mon compte")
        yield user


async def persist_session(*, email: str, name: str, picture: str, session_token: str) -> dict:
    now = datetime.now(timezone.utc)
    email = email.strip().lower()
    existing = await _db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        async with account_gate(user_id).access():
            if not await _db.users.find_one({"user_id": user_id}, {"_id": 0}):
                raise HTTPException(status_code=409, detail="Compte supprimé. Relancez la connexion.")
            await _db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture, "updated_at": now}})
            return await save_session(user_id, session_token, now)
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        try:
            await _db.users.insert_one({"user_id": user_id, "email": email, "name": name, "picture": picture, "created_at": now})
        except DuplicateKeyError:
            existing = await _db.users.find_one({"email": email}, {"_id": 0})
            user_id = existing["user_id"]

    async with account_gate(user_id).access():
        if not await _db.users.find_one({"user_id": user_id}, {"_id": 0}):
            raise HTTPException(status_code=409, detail="Compte supprimé. Relancez la connexion.")
        return await save_session(user_id, session_token, now)


async def save_session(user_id, session_token, now):
    await _db.user_sessions.update_one(
        {"session_token": session_token},
        {
            "$set": {"user_id": user_id, "expires_at": now + timedelta(days=SESSION_TTL_DAYS)},
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    logger.info("Session Google enregistrée pour %s", user_id)
    return await _db.users.find_one({"user_id": user_id}, {"_id": 0})


async def verify_and_create_session(token: str, user_agent: Optional[str] = None):
    logger.info(SESSION_AUTH_LOG_MESSAGE, (user_agent or "?")[:120])
    email, name, picture, session_token = None, "", "", None

    async with httpx.AsyncClient(timeout=10) as client:
        # 0. Si "token" est en réalité un code d'autorisation OAuth2 (c'est le cas
        #    de ton flux actuel : le frontend envoie params.code), il faut d'abord
        #    l'échanger contre un vrai id_token/access_token. Un code brut n'est
        #    valide ni sur /tokeninfo ni sur /userinfo : sans cette étape, la
        #    validation échoue toujours en 401, même avec un code Google réel.
        if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI:
            try:
                token_resp = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": GOOGLE_CLIENT_ID,
                        "client_secret": GOOGLE_CLIENT_SECRET,
                        "code": token,
                        "grant_type": "authorization_code",
                        "redirect_uri": GOOGLE_REDIRECT_URI,
                    },
                )
                if token_resp.status_code == 200:
                    token_data = token_resp.json()
                    token = token_data.get("id_token") or token_data.get("access_token", token)
                else:
                    logger.warning(
                        "Échange code->token refusé par Google (%s) : %s",
                        token_resp.status_code,
                        token_resp.text[:200],
                    )
            except Exception as e:
                logger.warning("Échec de l'échange code->token Google : %s", e)
        else:
            logger.warning(
                "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI absents du .env — "
                "tentative de validation directe du token brut (ne marchera pas si c'est un code)."
            )

        # 1. Validation si c'est un ID Token Google (JWT)
        try:
            resp = await client.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={token}")
            if resp.status_code == 200:
                data = resp.json()
                email = data.get("email")
                name = data.get("name", "")
                picture = data.get("picture", "")
                session_token = f"session_{uuid.uuid4().hex}"
        except Exception as e:
            logger.warning("Échec validation id_token Google : %s", e)

        # 2. Validation si c'est un Access Token Google
        if not email:
            try:
                userinfo_resp = await client.get(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={"Authorization": f"Bearer {token}"},
                )
                if userinfo_resp.status_code == 200:
                    data = userinfo_resp.json()
                    email = data.get("email")
                    name = data.get("name", "")
                    picture = data.get("picture", "")
                    session_token = f"session_{uuid.uuid4().hex}"
            except Exception as e:
                logger.warning("Échec validation userinfo Google : %s", e)

    if not email or not session_token:
        raise HTTPException(status_code=401, detail="Jeton Google invalide ou expiré")

    user = await persist_session(email=email, name=name, picture=picture, session_token=session_token)
    return {"session_token": session_token, "user": user}


def register_auth(api_router: APIRouter) -> None:
    @api_router.post("/auth/google/callback")
    async def google_callback(payload: dict, user_agent: Optional[str] = Header(None)):
        token = (
            payload.get("id_token")
            or payload.get("credential")
            or payload.get("token")
            or payload.get("code")
            or payload.get("session_id")
        )

        if not token:
            raise HTTPException(status_code=400, detail="Jeton Google manquant dans la requête")

        return await verify_and_create_session(token, user_agent)

    @api_router.post("/auth/session")
    async def create_session(body: SessionCreate, user_agent: Optional[str] = Header(None)):
        return await verify_and_create_session(body.session_id, user_agent)

    @api_router.get("/auth/me")
    async def me(user: dict = Depends(get_current_user)):
        return user

    @api_router.post("/auth/logout")
    async def logout(authorization: Optional[str] = Header(None)):
        if authorization and authorization.startswith("Bearer "):
            token = authorization.split(" ", 1)[1].strip()
            await _db.user_sessions.delete_one({"session_token": token})
        return {"ok": True}


router = APIRouter()
register_auth(router)
