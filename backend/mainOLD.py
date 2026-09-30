from dotenv import load_dotenv

# Charger les variables d'environnement avant d'importer les modules qui en dépendent
load_dotenv()

from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from services.gemini_service import analyser_photo_repas, RepasAnalyse
from database import init_db, enregistrer_repas, obtenir_historique
from auth import router as auth_router  # Adapte si ton fichier s'appelle différemment


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Remplace @app.on_event("startup"), déprécié par FastAPI
    init_db()
    yield


app = FastAPI(title="Insuline API", version="1.0.0", lifespan=lifespan)

# CORS — ton flux d'auth utilise un Bearer token (SecureStore), pas de cookie de
# session, donc allow_credentials=True n'est probablement pas requis. Je le garde
# pour rester fidèle à ta version : dans ce cas, allow_origins doit lister les
# origines explicitement ("*" n'est pas autorisé avec allow_credentials=True).
DEV_ORIGINS = [
    "http://localhost:8081",
    "http://localhost:8082",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:8082",
    "http://localhost:19006",
    "http://localhost:3000",
    "https://192.168.1.140:8081",  # ⚠️ remplace X par ta vraie IP locale (ipconfig) pour tester depuis un téléphone
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=DEV_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")


@app.post("/api/analyser-repas", response_model=RepasAnalyse)
async def endpoint_analyser_repas(
    file: UploadFile = File(...),
    ratio_glucides: float = Query(10.0, description="Grammes de glucides pour 1 U d'insuline"),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Le fichier fourni doit être une image.")

    try:
        contenu_image = await file.read()
        resultat = analyser_photo_repas(contenu_image, ratio_glucides=ratio_glucides)

        enregistrer_repas(
            nom_plat=resultat.nom_plat,
            glucides=resultat.estimation_glucides_g,
            dose=resultat.dose_insuline_suggeree_u,
            confiance=resultat.niveau_confiance,
        )

        return resultat
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'analyse : {str(e)}")


@app.get("/api/historique")
def endpoint_historique():
    return obtenir_historique()


@app.get("/")
def read_root():
    return {"status": "online", "message": "API Insuline fonctionnelle. Visitez /docs pour la documentation."}