import os
import uuid
import logging
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from dotenv import load_dotenv
load_dotenv()

import httpx
from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from pydantic import BaseModel, EmailStr

logger = logging.getLogger("auth2")

# ---------------------------------------------------------------------------
# Configuration Google OAuth & Environnement
# ---------------------------------------------------------------------------
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "903289007945-k1ttrrijqaflj368tc3ifkfdh7o8qooo.apps.googleusercontent.com")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8002/api/auth/google/callback")

db_auth = None

def init_auth(db):
    global db_auth
    db_auth = db

async def ensure_indexes():
    if db_auth is not None:
        try:
            await db_auth.users.create_index("email", unique=True)
            await db_auth.sessions.create_index("session_id", unique=True)
        except Exception as e:
            logger.warning("Erreur création d'index auth : %s", e)


# ---------------------------------------------------------------------------
# Helpers Mot de passe
# ---------------------------------------------------------------------------
def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def _verify_password(plain_password: str, hashed_password: str) -> bool:
    return _hash_password(plain_password) == hashed_password


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
        logger.warning("401 sans jeton — Accès refusé")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Jeton d'authentification manquant")

    # Recherche de la session
    session = await db_auth.sessions.find_one({"$or": [{"session_id": token}, {"token": token}]})
    
    if not session:
        # Fallback direct sur l'utilisateur
        user = await db_auth.users.find_one({"$or": [{"_id": token}, {"user_id": token}]})
        if user:
            user["user_id"] = str(user.get("user_id") or user.get("_id"))
            return user
        logger.warning("401 session inconnue : %s", token)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session invalide ou expirée")

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
        "created_at": datetime.utcnow().isoformat()
    }
    await db_auth.users.insert_one(user_doc)

    session_id = str(uuid.uuid4())
    await db_auth.sessions.insert_one({
        "session_id": session_id,
        "token": session_id,
        "user_id": user_id,
        "email": email,
        "created_at": datetime.utcnow().isoformat()
    })

    return {
        "access_token": session_id,
        "token": session_id,
        "session_token": session_id,  # attendu par auth.tsx (data?.session_token)
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
    session_id = str(uuid.uuid4())
    await db_auth.sessions.insert_one({
        "session_id": session_id,
        "token": session_id,
        "user_id": user_id,
        "email": email,
        "created_at": datetime.utcnow().isoformat()
    })

    return {
        "access_token": session_id,
        "token": session_id,
        "session_token": session_id,  # attendu par auth.tsx (data?.session_token)
        "token_type": "bearer",
        "user": {"id": user_id, "email": email, "name": user.get("name", "Utilisateur")}
    }

@router.post("/google/callback")
async def google_callback(payload: GoogleCallbackPayload, request: Request):
    logger.info("Connexion Google demandée — UA=%s", request.headers.get("user-agent"))

    if not GOOGLE_CLIENT_SECRET:
        logger.error("GOOGLE_CLIENT_SECRET est absent des variables d'environnement !")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GOOGLE_CLIENT_SECRET non configuré dans le fichier .env du backend."
        )

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
                err_detail = token_response.json() if "json" in token_response.headers.get("content-type", "") else token_response.text
                logger.warning("Échange code->token refusé par Google (%d) : %s", token_response.status_code, err_detail)
                # Arrêt immédiat de la requête si Google rejette l'échange
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

    # Recherche ou création de l'utilisateur
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
            "created_at": datetime.utcnow().isoformat()
        }
        await db_auth.users.insert_one(user)
    else:
        user_id = str(user.get("user_id") or user.get("_id"))

    # Création d'une nouvelle session
    session_id = str(uuid.uuid4())
    await db_auth.sessions.insert_one({
        "session_id": session_id,
        "token": session_id,
        "user_id": user_id,
        "email": email,
        "created_at": datetime.utcnow().isoformat()
    })

    return {
        "access_token": session_id,
        "token": session_id,
        "session_token": session_id,  # attendu par auth.tsx (data?.session_token)
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
import os
import uuid
import logging
from datetime import datetime
from typing import Optional, List
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, File, UploadFile, Query, HTTPException, Request, Depends, status
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import AsyncMongoClient
from bson import ObjectId

# Importations depuis auth2
from auth2 import router as auth_router
from auth2 import init_auth, ensure_indexes, get_current_user

# Import sécurisé de create_session_token
try:
    from auth2 import create_session_token
except ImportError:
    def create_session_token(user_id: str, email: str = "") -> str:
        return f"session_{user_id}_{uuid.uuid4().hex}"

from cgm import register_cgm
from tracking import register_tracking

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("insuline")

MONGO_URI = os.getenv("MONGO_URI", os.getenv("MONGODB_URL", "mongodb://localhost:27017"))
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", os.getenv("DB_NAME", "insulines"))

client: Optional[AsyncMongoClient] = None
current_db = None

class DynamicDBProxy:
    def __getitem__(self, name):
        if current_db is not None:
            return current_db[name]
        raise HTTPException(status_code=500, detail="Base de données non initialisée")

    def __getattr__(self, name):
        if current_db is not None:
            return getattr(current_db, name)
        raise HTTPException(status_code=500, detail="Base de données non initialisée")

db_proxy = DynamicDBProxy()

# Création du routeur API avec préfixe /api
api_router = APIRouter(prefix="/api")
register_cgm(api_router, db_proxy, get_current_user)
register_tracking(api_router, db_proxy, get_current_user)

@api_router.get("/glucose")
async def list_glucose(request: Request, limit: int = Query(200), current_user: dict = Depends(get_current_user)):
    db = request.app.state.db if hasattr(request.app.state, "db") else current_db
    user_id = str(current_user.get("user_id") or current_user.get("_id") or "")
    cursor = db.glucose_readings.find({"$or": [{"user_id": user_id}, {"userId": user_id}]}).sort([("_id", -1)]).limit(limit)
    items = []
    async for doc in cursor:
        doc["id"] = str(doc.pop("_id"))
        items.append(doc)
    return items

@api_router.get("/stats")
async def get_stats(request: Request, days: int = Query(7), current_user: dict = Depends(get_current_user)):
    db = request.app.state.db if hasattr(request.app.state, "db") else current_db
    user_id = str(current_user.get("user_id") or current_user.get("_id") or "")
    cursor = db.glucose_readings.find({"$or": [{"user_id": user_id}, {"userId": user_id}]}).sort([("_id", -1)]).limit(500)
    
    readings = []
    async for doc in cursor:
        val = doc.get("value_mgdl") or doc.get("value")
        if val is not None:
            try:
                readings.append(float(val))
            except (ValueError, TypeError):
                pass

    if not readings:
        return {"count": 0, "average": 0, "in_range_pct": 0, "hypo_pct": 0, "hyper_pct": 0}

    total = len(readings)
    return {
        "count": total,
        "average": round(sum(readings) / total, 1),
        "in_range_pct": round((sum(1 for r in readings if 70 <= r <= 180) / total) * 100, 1),
        "hypo_pct": round((sum(1 for r in readings if r < 70) / total) * 100, 1),
        "hyper_pct": round((sum(1 for r in readings if r > 180) / total) * 100, 1),
    }

@api_router.get("/profile")
async def get_profile(request: Request, current_user: dict = Depends(get_current_user)):
    db = request.app.state.db if hasattr(request.app.state, "db") else current_db
    user_id = str(current_user.get("user_id") or current_user.get("_id") or "")
    profile = await db.profiles.find_one({"$or": [{"user_id": user_id}, {"userId": user_id}]})
    if not profile:
        return {
            "first_name": current_user.get("first_name", ""),
            "target_min": 70.0,
            "target_max": 180.0,
            "diabetes_type": "type1"
        }
    profile["id"] = str(profile.pop("_id"))
    return profile

@api_router.get("/meals")
async def list_meals(request: Request, limit: int = Query(300), current_user: dict = Depends(get_current_user)):
    db = request.app.state.db if hasattr(request.app.state, "db") else current_db
    user_id = str(current_user.get("user_id") or current_user.get("_id") or "")
    cursor = db.meals.find({"$or": [{"user_id": user_id}, {"userId": user_id}]}).sort([("_id", -1)]).limit(limit)
    items = []
    async for doc in cursor:
        doc["id"] = str(doc.pop("_id"))
        items.append(doc)
    return items

@asynccontextmanager
async def lifespan(app: FastAPI):
    global client, current_db
    client = AsyncMongoClient(MONGO_URI)
    db = client[MONGO_DB_NAME]
    current_db = db
    app.state.db = db
    init_auth(db)
    await ensure_indexes()
    logger.info(f"Connecté à MongoDB : {MONGO_DB_NAME}")
    yield
    if client:
        await client.close()

app = FastAPI(title="GlycoSoin API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(api_router)