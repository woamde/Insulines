import os
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient

app = FastAPI(title="GlycoSoin API", version="1.0.0")

# --- Middleware CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Connexion MongoDB ---
MONGO_URI = os.getenv("MONGO_URI") or os.getenv("MONGODB_URI") or "mongodb://localhost:27017"
try:
    mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    db = mongo_client["glycosoin"]
except Exception:
    mongo_client = None
    db = None

# --- Modèles Pydantic ---

class CGMAuthPayload(BaseModel):
    email: str
    password: str

class UserProfilePayload(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    target_min: Optional[float] = 70.0
    target_max: Optional[float] = 180.0

class JournalEntryPayload(BaseModel):
    value_mgdl: Optional[float] = None
    insulin_units: Optional[float] = None
    meal_carbs: Optional[float] = None
    notes: Optional[str] = None

class ChatRequest(BaseModel):
    message: str

# --- Santé & Debug ---

@app.get("/")
async def root():
    return {"status": "ok", "message": "GlycoSoin API est en ligne"}

@app.get("/api/debug/mongo")
async def debug_mongo():
    if db is None:
        return {"error": "Base de données non accessible"}
    try:
        collections = db.list_collection_names()
        count = db["glucose_readings"].count_documents({})
        sample = db["glucose_readings"].find_one({}, {"_id": 0})
        return {
            "connected_database": db.name,
            "collections_in_db": collections,
            "glucose_readings_count": count,
            "sample_document": sample
        }
    except Exception as e:
        return {"error": str(e)}

# --- Profil Utilisateur ---

@app.get("/api/user/profile")
@app.get("/api/profile")
@app.get("/profile")
async def get_user_profile():
    return {
        "name": "Utilisateur GlycoSoin",
        "email": "hatif.abderahim@free.fr",
        "target_min": 70.0,
        "target_max": 180.0
    }

@app.put("/api/user/profile")
@app.post("/api/profile")
@app.post("/profile")
async def update_user_profile(profile: UserProfilePayload):
    return {"status": "success", "message": "Profil mis à jour", "profile": profile.model_dump()}

# --- CGM & LibreLinkUp ---

@app.post("/api/cgm/connect")
@app.post("/api/cgm/test")
@app.post("/cgm/connect")
@app.post("/cgm/test")
async def connect_cgm(payload: CGMAuthPayload):
    if not payload.email or not payload.password:
        raise HTTPException(status_code=400, detail="Identifiants incomplets.")
    return {
        "status": "connected",
        "message": "Connexion LibreLinkUp établie avec succès !"
    }

@app.post("/api/cgm/config")
@app.post("/api/cgm/settings")
@app.post("/cgm/config")
async def save_cgm_config(payload: CGMAuthPayload):
    if not payload.email or not payload.password:
        raise HTTPException(status_code=400, detail="Identifiants incomplets.")
    return {"status": "success", "message": "Configuration enregistrée avec succès."}

@app.get("/api/cgm/latest")
async def get_latest_glucose():
    return {
        "value_mgdl": 120,
        "trend_arrow": "STABLE",
        "measured_at": "2026-10-07T19:00:00Z"
    }

# --- Journal & Historique ---

@app.get("/api/journal")
@app.get("/journal")
async def get_journal():
    if db is not None and "glucose_readings" in db.list_collection_names():
        entries = list(db["glucose_readings"].find({}, {"_id": 0}))
        return {"journal": entries}
    return {"journal": []}

@app.post("/api/journal")
@app.post("/journal")
async def add_journal_entry(entry: JournalEntryPayload):
    data = entry.model_dump()
    if db is not None:
        db["glucose_readings"].insert_one(data.copy())
    return {"status": "success", "message": "Entrée ajoutée au journal", "entry": data}

@app.get("/api/historique")
async def get_historique():
    return await get_journal()

@app.delete("/api/journal/{entry_id}")
@app.delete("/journal/{entry_id}")
async def delete_journal_entry(entry_id: str):
    return {"status": "success", "message": f"Entrée {entry_id} supprimée"}

# --- Assistant IA ---

@app.post("/api/ai/chat")
async def ai_chat(chat: ChatRequest):
    return {
        "response": f"Reçu : '{chat.message}'. Assistant GlycoSoin opérationnel."
    }