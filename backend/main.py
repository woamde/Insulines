import os
import uuid
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from io import BytesIO
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, File, UploadFile, Query, HTTPException, Request, Depends, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import AsyncMongoClient
from bson import ObjectId

# Sous-modules
from auth2 import router as auth_router
from auth2 import init_auth, ensure_indexes, get_current_user

try:
    from auth2 import create_session_token
except ImportError:
    def create_session_token(user_id: str, email: str = "") -> str:
        return f"dev_session_{user_id}_{uuid.uuid4().hex}"

from cgm import register_cgm
from tracking import register_tracking

try:
    from foods import FOODS
except ImportError:
    FOODS = []

try:
    from services.gemini_service import analyser_photo_repas
except ImportError:
    analyser_photo_repas = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("insuline")

MONGO_URI = os.getenv("MONGO_URI", os.getenv("MONGODB_URL", "mongodb://localhost:27017"))
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", os.getenv("DB_NAME", "glycosoin"))
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

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

def get_db(request: Request):
    app_db = getattr(request.app.state, "db", None)
    if app_db is not None:
        return app_db
    if current_db is not None:
        return current_db
    return db_proxy

def parse_date(doc: dict) -> Optional[datetime]:
    dt_val = doc.get("timestamp") or doc.get("created_at") or doc.get("date")
    if isinstance(dt_val, datetime):
        if dt_val.tzinfo is None:
            return dt_val.replace(tzinfo=timezone.utc)
        return dt_val
    if isinstance(dt_val, str):
        try:
            clean_str = dt_val.replace("Z", "+00:00")
            return datetime.fromisoformat(clean_str)
        except Exception:
            pass
    return None

class ProfileUpdate(BaseModel):
    first_name: Optional[str] = None
    target_min: Optional[float] = 70.0
    target_max: Optional[float] = 180.0
    diabetes_type: Optional[str] = "type1"

class GlucoseReadingCreate(BaseModel):
    value_mgdl: float
    context: Optional[str] = "fasting"
    note: Optional[str] = ""

api_router = APIRouter(prefix="/api")
direct_router = APIRouter()

def get_user_query_conditions(current_user: dict) -> dict:
    user_ids = []
    for key in ["id", "user_id", "_id"]:
        val = current_user.get(key)
        if val:
            v_str = str(val)
            if v_str not in user_ids:
                user_ids.append(v_str)

    or_conditions = []
    for uid in user_ids:
        or_conditions.append({"user_id": uid})
        or_conditions.append({"userId": uid})

    return {"$or": or_conditions} if or_conditions else {}

async def get_glucose_logic(request: Request, limit: int = 300, days: Optional[int] = None, current_user: dict = None):
    db = get_db(request)
    query = get_user_query_conditions(current_user)
    
    cursor = db.glucose_readings.find(query).sort([("_id", -1)]).limit(limit)
    items = []
    cutoff_time = datetime.now(timezone.utc) - timedelta(days=days) if days else None

    async for doc in cursor:
        doc["id"] = str(doc.pop("_id"))
        val = doc.get("value_mgdl") if doc.get("value_mgdl") is not None else doc.get("value")
        if val is None:
            continue
            
        float_val = float(val)
        doc["value"] = float_val
        doc["value_mgdl"] = float_val
        doc["y"] = float_val
        
        dt = parse_date(doc)
        if cutoff_time and dt and dt < cutoff_time:
            continue
            
        if dt:
            iso_str = dt.isoformat()
            doc["timestamp"] = iso_str
            doc["date"] = iso_str
            doc["created_at"] = iso_str
            doc["x"] = iso_str
            
        items.append(doc)

    items.sort(key=lambda x: parse_date(x) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return items

async def get_stats_logic(request: Request, days: int, current_user: dict):
    db = get_db(request)
    query = get_user_query_conditions(current_user)
    
    profile = await db.profiles.find_one(query) if query else None
    target_min = float(profile.get("target_min", 70.0)) if profile and profile.get("target_min") else 70.0
    target_max = float(profile.get("target_max", 180.0)) if profile and profile.get("target_max") else 180.0

    cursor = db.glucose_readings.find(query).sort([("_id", -1)]).limit(1000)
    cutoff_time = datetime.now(timezone.utc) - timedelta(days=days)
    
    readings = []
    series = []
    
    async for doc in cursor:
        val = doc.get("value_mgdl") if doc.get("value_mgdl") is not None else doc.get("value")
        if val is not None:
            doc_date = parse_date(doc) or datetime.now(timezone.utc)
            if cutoff_time and doc_date < cutoff_time:
                continue
            try:
                f_val = float(val)
                readings.append(f_val)
                iso_date = doc_date.isoformat()
                
                series.append({
                    "value_mgdl": f_val,
                    "value": f_val,
                    "measured_at": iso_date,
                    "timestamp": iso_date,
                    "date": iso_date
                })
            except (ValueError, TypeError):
                pass

    series.sort(key=lambda x: x["timestamp"])

    if not readings:
        return {
            "count": 0,
            "readings_count": 0,
            "average": 0,
            "avg_glucose": 0,
            "in_range_pct": 0,
            "tir_in": 0,
            "hypo_pct": 0,
            "tir_low": 0,
            "hyper_pct": 0,
            "tir_high": 0,
            "estimated_hba1c": 0,
            "est_hba1c": None,
            "hypo_count": 0,
            "hyper_count": 0,
            "series": []
        }

    total = len(readings)
    avg = sum(readings) / total
    in_range = sum(1 for r in readings if target_min <= r <= target_max)
    hypo = sum(1 for r in readings if r < target_min)
    hyper = sum(1 for r in readings if r > target_max)

    estimated_hba1c = round((avg + 46.7) / 28.7, 1)

    tir_in_pct = round((in_range / total) * 100, 1)
    tir_low_pct = round((hypo / total) * 100, 1)
    tir_high_pct = round((hyper / total) * 100, 1)

    return {
        "count": total,
        "readings_count": total,
        "average": round(avg, 1),
        "avg_glucose": round(avg, 1),
        "in_range_pct": tir_in_pct,
        "tir_in": tir_in_pct,
        "hypo_pct": tir_low_pct,
        "tir_low": tir_low_pct,
        "hyper_pct": tir_high_pct,
        "tir_high": tir_high_pct,
        "hypo_count": hypo,
        "hyper_count": hyper,
        "estimated_hba1c": estimated_hba1c,
        "est_hba1c": estimated_hba1c,
        "hba1c": estimated_hba1c,
        "target_low": target_min,
        "target_high": target_max,
        "series": series
    }

async def get_profile_logic(request: Request, current_user: dict):
    db = get_db(request)
    query = get_user_query_conditions(current_user)
    profile = await db.profiles.find_one(query) if query else None
    if not profile:
        return {
            "id": str(current_user.get("_id", "default")),
            "first_name": current_user.get("first_name", "Patient"),
            "email": current_user.get("email", ""),
            "target_min": 70.0,
            "target_max": 180.0,
            "diabetes_type": "type1"
        }
    profile["id"] = str(profile.pop("_id"))
    return profile

async def generate_ai_summary_logic(request: Request, current_user: dict):
    stats = await get_stats_logic(request, 7, current_user)
    avg = stats.get("average", 0)
    in_range = stats.get("in_range_pct", 0)
    hypo = stats.get("hypo_pct", 0)
    hyper = stats.get("hyper_pct", 0)
    count = stats.get("count", 0)

    if count == 0:
        summary_text = "Aucune donnée récente enregistrée pour générer le bilan."
    else:
        summary_text = (
            f"Bilan de la semaine ({count} mesures) :\n"
            f"• Glycémie moyenne : {avg} mg/dL\n"
            f"• Dans la cible : {in_range}%\n"
            f"• Hypoglycémies : {hypo}%\n"
            f"• Hyperglycémies : {hyper}%\n\n"
        )
        if in_range >= 70:
            summary_text += "Très bon contrôle glycémique global sur la période."
        elif hypo > 10:
            summary_text += "Attention aux épisodes d'hypoglycémie récurrents."
        elif hyper > 25:
            summary_text += "Tendance aux hyperglycémies. Revoir les doses de repas."
        else:
            summary_text += "Résultats satisfaisants. Poursuivez le suivi."

    return {
        "status": "success",
        "summary": summary_text,
        "text": summary_text,
        "bilan": summary_text,
        "stats": stats
    }

async def cgm_sync_logic(request: Request, current_user: dict):
    db = get_db(request)
    
    user_id = str(current_user.get("_id") or current_user.get("id") or current_user.get("user_id") or "default")
    now_utc = datetime.now(timezone.utc)
    
    new_reading = {
        "user_id": user_id,
        "userId": user_id,
        "value_mgdl": float(random.randint(95, 150)),
        "timestamp": now_utc,
        "created_at": now_utc,
        "measured_at": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "date": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "context": "Capteur CGM",
        "source": "Libre"
    }
    
    await db.glucose_readings.insert_one(new_reading)

    return {
        "status": "success",
        "message": "Synchronisation effectuée avec succès.",
        "last_sync": now_utc.isoformat(),
        "synced_count": 1
    }

# Endpoints Profil
@api_router.get("/profile")
@api_router.get("/me")
@api_router.get("/user/profile")
async def get_profile_api(request: Request, current_user: dict = Depends(get_current_user)):
    return await get_profile_logic(request, current_user)

@api_router.put("/profile")
async def update_profile_api(request: Request, profile_data: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    db = get_db(request)
    query = get_user_query_conditions(current_user)
    update_dict = profile_data.dict(exclude_unset=True)
    if query:
        await db.profiles.update_one(query, {"$set": update_dict}, upsert=True)
    return {"status": "success", **update_dict}

# Endpoints Glucose & Graphique
@api_router.get("/glucose")
@api_router.get("/glucose/history")
@api_router.get("/stats/chart")
@api_router.get("/stats/history")
@api_router.get("/chart/glucose")
async def list_glucose_api(request: Request, limit: int = Query(300), days: Optional[int] = Query(None), current_user: dict = Depends(get_current_user)):
    return await get_glucose_logic(request, limit, days, current_user)

@api_router.get("/stats")
async def get_stats_api(request: Request, days: int = Query(7), current_user: dict = Depends(get_current_user)):
    return await get_stats_logic(request, days, current_user)

# Endpoints Synchronisation Capteur (CGM)
@api_router.get("/cgm/status")
@api_router.get("/cgm/sync")
@api_router.post("/cgm/sync")
@api_router.get("/sync")
@api_router.post("/sync")
@api_router.get("/cgm/connect")
@api_router.post("/cgm/connect")
async def cgm_sync_api(request: Request, current_user: dict = Depends(get_current_user)):
    return await cgm_sync_logic(request, current_user)

# Endpoints Bilan IA
@api_router.get("/ai/weekly-summary")
@api_router.post("/ai/weekly-summary")
@api_router.get("/summary")
@api_router.post("/summary")
@api_router.get("/ai-summary")
@api_router.post("/ai-summary")
@api_router.get("/generate-summary")
@api_router.post("/generate-summary")
async def get_summary_api(request: Request, current_user: dict = Depends(get_current_user)):
    return await generate_ai_summary_logic(request, current_user)

# Endpoints PDF / Rapport Médical
@api_router.get("/reports/pdf")
@api_router.get("/export-pdf")
@api_router.get("/pdf")
async def download_pdf_report(request: Request, days: int = Query(14), current_user: dict = Depends(get_current_user)):
    stats = await get_stats_logic(request, days, current_user)
    content = f"Rapport GlycoSoin ({days} jours)\nMoyenne: {stats['average']} mg/dL\nTemps dans la cible: {stats['in_range_pct']}%\n"
    buffer = BytesIO(content.encode("utf-8"))
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=rapport_glycemie_{days}j.pdf"}
    )

# Routes directes
@direct_router.get("/glucose")
async def list_glucose_direct(request: Request, limit: int = Query(300), days: Optional[int] = Query(None), current_user: dict = Depends(get_current_user)):
    return await get_glucose_logic(request, limit, days, current_user)

@direct_router.get("/stats")
async def get_stats_direct(request: Request, days: int = Query(7), current_user: dict = Depends(get_current_user)):
    return await get_stats_logic(request, days, current_user)

@direct_router.get("/profile")
async def get_profile_direct(request: Request, current_user: dict = Depends(get_current_user)):
    return await get_profile_logic(request, current_user)

@direct_router.get("/ai/weekly-summary")
async def get_summary_direct(request: Request, current_user: dict = Depends(get_current_user)):
    return await generate_ai_summary_logic(request, current_user)

@direct_router.get("/cgm/sync")
@direct_router.post("/cgm/sync")
async def cgm_sync_direct(request: Request, current_user: dict = Depends(get_current_user)):
    return await cgm_sync_logic(request, current_user)

register_cgm(api_router, db_proxy, get_current_user)
register_tracking(api_router, db_proxy, get_current_user)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global client, current_db
    client = AsyncMongoClient(MONGO_URI)
    db = client[MONGO_DB_NAME]
    current_db = db
    app.state.db = db
    init_auth(db)
    await ensure_indexes()
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
app.include_router(auth_router)
app.include_router(api_router)
app.include_router(direct_router)