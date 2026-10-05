import os
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

from dotenv import load_dotenv
load_dotenv()

import bcrypt
import httpx
from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from pydantic import BaseModel, EmailStr

logger = logging.getLogger("auth2")

# ---------------------------------------------------------------------------
# Configuration Google OAuth & Environnement
# ---------------------------------------------------------------------------
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "")

# Durée de vie d'une session
SESSION_TTL_DAYS = 7

db_auth = None

def init_auth(db):
    global db_auth
    db_auth = db

async def ensure_indexes():
    if db_auth is not None:
        try:
            await db_auth.users.create_index("email", unique=True)
            await db_auth.sessions.create_index("session_id", unique=True)
            await db_auth.sessions.create_index("expires_at", expireAfterSeconds=0)
        except Exception as e:
            logger.warning("Erreur création d'index auth : %s", e)

# ---------------------------------------------------------------------------
# Helpers Mot de passe (bcrypt)
# ---------------------------------------------------------------------------
def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def _verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except (ValueError, TypeError):
        return False

# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------
async def _new_session(user_id: str, email: str) -> str:
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await db_auth.sessions.insert_one({
        "session_id": session_id,
        "token": session_id,
        "user_id": user_id,
        "email": email,
        "created_at": now,
        "expires_at": now + timedelta(days=SESSION_TTL_DAYS),
    })
    return session_id

# ---------------------------------------------------------------------------
# Schémas Pydantic
# ---------------------------------------------------------------------------
class LoginPayload(BaseModel):
    email: EmailStr
    password: str

class RegisterPayload(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = "Utilisateur"

class GoogleCallbackPayload(BaseModel):
    code: Optional[str] = None
    id_token: Optional[str] = None
    redirect_uri: Optional[str] = None

# ---------------------------------------------------------------------------
# Dépendance Authentification (get_current_user)
# ---------------------------------------------------------------------------
async def get_current_user(
    authorization: Optional[str] = Header(None),
    x_session_id: Optional[str] = Header(None, alias="X-Session-ID")
) -> Dict[str, Any]:
    if db_auth is None:
        raise HTTPException(status_code=500, detail="Base de données d'authentification non initialisée")

    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
    elif authorization:
        token = authorization
    elif x_session_id:
        token = x_session_id

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Jeton d'authentification manquant")

    session = await db_auth.sessions.find_one({"$or": [{"session_id": token}, {"token": token}]})

    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session invalide ou expirée")

    expires_at = session.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            await db_auth.sessions.delete_one({"_id": session["_id"]})
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expirée")

    user_id = session.get("user_id")
    user = await db_auth.users.find_one({"$or": [{"_id": user_id}, {"user_id": user_id}]})

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur introuvable")

    user["user_id"] = str(user.get("user_id") or user.get("_id"))
    return user

# ---------------------------------------------------------------------------
# Routeur d'Authentification
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register")
async def register(payload: RegisterPayload):
    email = payload.email.lower()
    existing = await db_auth.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Un compte existe déjà avec cet e-mail")

    user_id = str(uuid.uuid4())
    user_doc = {
        "_id": user_id,
        "user_id": user_id,
        "email": email,
        "password": _hash_password(payload.password),
        "name": payload.name,
        "provider": "local",
        "created_at": datetime.now(timezone.utc),
    }
    await db_auth.users.insert_one(user_doc)
    session_id = await _new_session(user_id, email)

    return {
        "access_token": session_id,
        "token": session_id,
        "session_token": session_id,
        "token_type": "bearer",
        "user": {"id": user_id, "email": email, "name": payload.name}
    }

@router.post("/login")
async def login(payload: LoginPayload):
    email = payload.email.lower()
    user = await db_auth.users.find_one({"email": email})
    if not user or not _verify_password(payload.password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="Identifiants incorrects")

    user_id = str(user.get("user_id") or user.get("_id"))
    session_id = await _new_session(user_id, email)

    return {
        "access_token": session_id,
        "token": session_id,
        "session_token": session_id,
        "token_type": "bearer",
        "user": {"id": user_id, "email": email, "name": user.get("name", "Utilisateur")}
    }

@router.post("/google/callback")
async def google_callback(payload: GoogleCallbackPayload, request: Request):
    code = payload.code
    redirect_uri = payload.redirect_uri or GOOGLE_REDIRECT_URI
    google_user = None

    if code:
        async with httpx.AsyncClient() as client:
            token_response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )

            if token_response.status_code != 200:
                err_detail = token_response.text
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Erreur d'authentification Google OAuth ({token_response.status_code}): {err_detail}"
                )

            token_data = token_response.json()
            access_token = token_data.get("access_token")

            userinfo_response = await client.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {access_token}"}
            )

            if userinfo_response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Impossible d'obtenir le profil depuis Google."
                )

            google_user = userinfo_response.json()

    elif payload.id_token:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={payload.id_token}")
            if res.status_code != 200:
                raise HTTPException(status_code=401, detail="id_token Google invalide")
            google_user = res.json()
    else:
        raise HTTPException(status_code=400, detail="Code d'autorisation ou id_token requis")

    if not google_user or "email" not in google_user:
        raise HTTPException(status_code=400, detail="Profil Google incomplet ou invalide")

    email = google_user["email"].lower()
    name = google_user.get("name", google_user.get("given_name", "Utilisateur"))

    user = await db_auth.users.find_one({"email": email})
    if not user:
        user_id = str(uuid.uuid4())
        user = {
            "_id": user_id,
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": google_user.get("picture"),
            "provider": "google",
            "created_at": datetime.now(timezone.utc),
        }
        await db_auth.users.insert_one(user)
    else:
        user_id = str(user.get("user_id") or user.get("_id"))

    session_id = await _new_session(user_id, email)

    return {
        "access_token": session_id,
        "token": session_id,
        "session_token": session_id,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": google_user.get("picture"),
        }
    }

@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user.get("user_id") or current_user.get("_id"))
    return {
        "id": user_id,
        "user_id": user_id,
        "email": current_user.get("email"),
        "name": current_user.get("name", "Utilisateur")
    }

@router.post("/logout")
async def logout(
    authorization: Optional[str] = Header(None),
    x_session_id: Optional[str] = Header(None, alias="X-Session-ID")
):
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
    elif authorization:
        token = authorization
    elif x_session_id:
        token = x_session_id

    if token and db_auth is not None:
        await db_auth.sessions.delete_many({"$or": [{"session_id": token}, {"token": token}]})
    return {"ok": True}