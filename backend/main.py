import datetime
import os
import asyncio
from contextlib import asynccontextmanager
import motor.motor_asyncio
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# Imports locaux
from auth import get_current_user

try:
    import cgm
    from cgm import register_cgm
except ImportError:
    cgm = None
    def register_cgm(router, db, auth_dep):
        pass

# Modèle Pydantic pour le profil
class ProfileSchema(BaseModel):
    first_name: Optional[str] = None
    firstName: Optional[str] = None
    name: Optional[str] = None
    target_min: Optional[float] = None
    targetMin: Optional[float] = None
    target_max: Optional[float] = None
    targetMax: Optional[float] = None
    diabetes_type: Optional[str] = None
    diabetesType: Optional[str] = None
    weight: Optional[float] = None
    height: Optional[float] = None

# Cache en mémoire avec valeurs par défaut
user_profile_cache = {
    "id": "demo",
    "user_id": "demo",
    "first_name": "Abderahim",
    "firstName": "Abderahim",
    "name": "Abderahim",
    "target_min": 70.0,
    "targetMin": 70.0,
    "target_max": 180.0,
    "targetMax": 180.0,
    "diabetes_type": "type1",
    "diabetesType": "type1",
    "weight": 70.0,
    "height": 170.0,
    "is_configured": True,
    "isConfigured": True,
    "configured": True
}

# Connexion MongoDB
def get_db():
    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.getenv("DB_NAME", "insulines")
    client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=2000)
    return client[db_name]

db_instance = get_db()

def to_local_iso(dt_val):
    if not dt_val:
        return None
    try:
        if isinstance(dt_val, str):
            dt_obj = datetime.datetime.fromisoformat(dt_val.replace("Z", "+00:00"))
        elif isinstance(dt_val, datetime.datetime):
            dt_obj = dt_val
        else:
            return str(dt_val)
        if dt_obj.tzinfo is None:
            dt_obj = dt_obj.replace(tzinfo=datetime.timezone.utc)
        return dt_obj.astimezone().isoformat()
    except Exception:
        return str(dt_val)

# Worker de synchronisation en arrière-plan (exécuté toutes les 5 minutes)
async def cgm_auto_sync_worker():
    while True:
        try:
            if cgm and hasattr(cgm, "fetch_latest_from_libre"):
                db = get_db()
                await cgm.fetch_latest_from_libre(db, {"_id": "user_patient_default"})
        except Exception as e:
            print(f"[Auto-Sync Error] : {e}")
        await asyncio.sleep(300)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Démarrage de la tâche de synchro en tâche de fond
    sync_task = asyncio.create_task(cgm_auto_sync_worker())
    yield
    sync_task.cancel()

app = FastAPI(
    title="GlycoSoin API",
    description="API de suivi glycémique",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter()

@api_router.get("/health")
async def health_check():
    return {"status": "ok"}

@api_router.get("/profile")
@api_router.get("/api/profile")
async def get_profile(current_user: dict = Depends(get_current_user)):
    try:
        db = get_db()
        doc = await db["profiles"].find_one({"user_id": "demo"})
        if doc:
            doc.pop("_id", None)
            user_profile_cache.update(doc)
    except Exception as e:
        print(f"Mongo get profile warning: {e}")
    return user_profile_cache

@api_router.put("/profile")
@api_router.post("/profile")
@api_router.put("/api/profile")
@api_router.post("/api/profile")
async def update_profile(data: ProfileSchema, current_user: dict = Depends(get_current_user)):
    fn = data.first_name or data.firstName or data.name or user_profile_cache.get("first_name", "Abderahim")
    t_min = data.target_min if data.target_min is not None else (data.targetMin if data.targetMin is not None else user_profile_cache.get("target_min", 70.0))
    t_max = data.target_max if data.target_max is not None else (data.targetMax if data.targetMax is not None else user_profile_cache.get("target_max", 180.0))
    d_type = data.diabetes_type or data.diabetesType or user_profile_cache.get("diabetes_type", "type1")
    weight = data.weight if data.weight is not None else user_profile_cache.get("weight", 70.0)
    height = data.height if data.height is not None else user_profile_cache.get("height", 170.0)

    updated_data = {
        "id": "demo",
        "user_id": "demo",
        "first_name": fn,
        "firstName": fn,
        "name": fn,
        "target_min": float(t_min),
        "targetMin": float(t_min),
        "target_max": float(t_max),
        "targetMax": float(t_max),
        "diabetes_type": d_type,
        "diabetesType": d_type,
        "weight": float(weight),
        "height": float(height),
        "is_configured": True,
        "isConfigured": True,
        "configured": True
    }

    user_profile_cache.update(updated_data)

    try:
        db = get_db()
        await db["profiles"].update_one(
            {"user_id": "demo"},
            {"$set": updated_data},
            upsert=True
        )
    except Exception as e:
        print(f"Mongo update profile warning: {e}")

    return {"status": "ok", "profile": user_profile_cache}

@api_router.get("/stats")
@api_router.get("/api/stats")
async def get_stats(days: int = 7, current_user: dict = Depends(get_current_user)):
    try:
        db = get_db()
        docs = await db["glucose_readings"].find({}).to_list(length=500)
    except Exception:
        docs = []

    values = [float(d.get("value_mgdl") or d.get("value") or 110) for d in docs if d]
    if not values:
        values = [110, 120, 115]

    avg = round(sum(values) / len(values))
    in_range = round((sum(1 for v in values if 70 <= v <= 180) / len(values)) * 100)

    return {
        "average": avg,
        "in_range_pct": in_range,
        "period_days": days
    }

@api_router.get("/glucose")
@api_router.get("/api/glucose")
@api_router.get("/measurements")
@api_router.get("/api/measurements")
async def get_glucose(limit: int = 100, current_user: dict = Depends(get_current_user)):
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        db = get_db()
        cursor = db["glucose_readings"].find({}).sort([("measured_at", -1), ("created_at", -1)]).limit(limit)
        docs = await cursor.to_list(length=limit)
    except Exception:
        docs = []

    readings = []
    for doc in docs:
        raw_date = doc.get("measured_at") or doc.get("timestamp") or doc.get("created_at") or now
        val = doc.get("value_mgdl") or doc.get("value") or 110
        readings.append({
            "_id": str(doc["_id"]),
            "user_id": str(doc.get("user_id", "")),
            "value": val,
            "value_mgdl": val,
            "measured_at": to_local_iso(raw_date),
            "timestamp": to_local_iso(raw_date),
            "source": doc.get("source", "Libre"),
            "trend": doc.get("trend", "Flat"),
            "trend_arrow": doc.get("trend_arrow", "→")
        })

    return readings

register_cgm(api_router, db_instance, get_current_user)
app.include_router(api_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)