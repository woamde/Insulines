import os
from contextlib import asynccontextmanager

# ============================================================
# ENVIRONNEMENT
# ============================================================

# IMPORTANT :
# Charger .env AVANT d'importer auth.py et ai.py,
# car ces modules lisent leurs variables d'environnement
# lors de leur import.
from dotenv import load_dotenv

load_dotenv()


# ============================================================
# IMPORTS
# ============================================================

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

from auth import (
    router as auth_router,
    init_auth,
    ensure_indexes,
)

from ai import (
    register_ai,
    init_ai,
)

from database import init_db


# ============================================================
# CONFIGURATION
# ============================================================

MONGO_URL = os.getenv(
    "MONGO_URL",
    "mongodb://localhost:27017",
)

DB_NAME = os.getenv(
    "DB_NAME",
    "glycosoin",
)

APP_NAME = "GlycoSoin API"


# ============================================================
# CLIENT MONGODB
# ============================================================

mongo_client: AsyncIOMotorClient | None = None


# ============================================================
# LIFESPAN FASTAPI
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Initialisation et arrêt propre de l'application.

    Ordre :
        1. Initialisation SQLite locale
        2. Connexion MongoDB
        3. Initialisation auth
        4. Initialisation IA
        5. Création des index MongoDB
        6. Ping MongoDB
        7. Démarrage de l'application
        8. Fermeture propre de MongoDB
    """

    global mongo_client

    # --------------------------------------------------------
    # SQLite / données locales
    # --------------------------------------------------------

    init_db()

    # --------------------------------------------------------
    # MongoDB
    # --------------------------------------------------------

    mongo_client = AsyncIOMotorClient(
        MONGO_URL,
        serverSelectionTimeoutMS=5000,
    )

    db = mongo_client[DB_NAME]

    # --------------------------------------------------------
    # Initialisation des modules
    # --------------------------------------------------------

    init_auth(db)
    init_ai(db)

    # --------------------------------------------------------
    # Vérification de la connexion MongoDB
    # --------------------------------------------------------

    await db.command("ping")

    # --------------------------------------------------------
    # Index MongoDB
    # --------------------------------------------------------

    await ensure_indexes()

    print("========================================")
    print(APP_NAME)
    print("MongoDB connecté.")
    print(f"Base utilisée : {DB_NAME}")
    print("========================================")

    try:
        yield

    finally:
        # ----------------------------------------------------
        # Arrêt propre
        # ----------------------------------------------------

        if mongo_client is not None:
            mongo_client.close()
            print("MongoDB déconnecté.")


# ============================================================
# APPLICATION FASTAPI
# ============================================================

app = FastAPI(
    title=APP_NAME,
    description="Backend de l'application GlycoSoin T1D",
    version="1.0.0",
    lifespan=lifespan,
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,

    allow_origins=[
        # Frontend principal
        "http://localhost:8081",
        "http://127.0.0.1:8081",

        # Autres ports déjà utilisés par le projet
        "http://localhost:8082",
        "http://127.0.0.1:8082",

        "http://localhost:8083",
        "http://127.0.0.1:8083",

        # Expo / développement éventuel
        "http://localhost:19006",
        "http://127.0.0.1:19006",

        # Autre frontend éventuel
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],

    allow_credentials=False,

    allow_methods=[
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
    ],

    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
    ],
)


# ============================================================
# ROUTEUR API
# ============================================================

api_router = APIRouter()


# ============================================================
# AUTHENTIFICATION
# ============================================================

# auth.py contient déjà son propre APIRouter.
# On l'intègre dans le routeur API principal.
api_router.include_router(
    auth_router,
)


# ============================================================
# IA / COACH
# ============================================================

# register_ai() attend un APIRouter.
# L'ancien main.py lui passait directement l'objet FastAPI,
# ce qui n'était pas cohérent avec sa signature.
register_ai(
    api_router,
)


# ============================================================
# ROUTES API
# ============================================================

# Toutes les routes déclarées dans api_router deviennent :
#
#   /api/auth/...
#   /api/ai/...
#
app.include_router(
    api_router,
    prefix="/api",
)


# ============================================================
# ROUTE RACINE
# ============================================================

@app.get("/")
async def root():
    return {
        "status": "online",
        "service": APP_NAME,
        "version": "1.0.0",
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
async def health():
    return {
        "status": "ok",
    }