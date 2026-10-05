from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional, Any

from fastapi import FastAPI, APIRouter, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from bson import ObjectId

# 1. Configuration et connexion MongoDB
MONGODB_URL = "mongodb://localhost:27017"
DATABASE_NAME = "glycosoin_db"

client: Optional[AsyncIOMotorClient] = None
db: Any = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global client, db
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[DATABASE_NAME]
    yield
    if client:
        client.close()

# 2. Initialisation de FastAPI
app = FastAPI(title="GlycoSoin API", lifespan=lifespan)

# 3. Configuration CORS
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 4. Routeurs
auth_router = APIRouter(prefix="/auth", tags=["auth"])
api_router = APIRouter(tags=["default"])

# 5. Structure par défaut du profil
DEFAULT_PROFILE = {
    "name": "Utilisateur",
    "email": "patient@example.com",
    "age": None,
    "height_cm": None,
    "weight_kg": None,
    "diabetes_years": None,
    "ic_ratio": 10.0,
    "isf": 30.0,
    "target_glucose": 100.0,
    "target_low": 70.0,
    "target_high": 180.0,
    "tir_goal": 70.0,
    "doctor_name": "",
    "doctor_email": "",
    "glucose_unit": "mgdl",
    "profile_completed": False,
}

# 6. Modèles Pydantic
class GlucoseInput(BaseModel):
    value: Optional[float] = None
    value_mgdl: Optional[float] = None
    unit: str = "mg/dL"
    source: Optional[str] = "manuel"
    timestamp: Optional[datetime] = None
    measured_at: Optional[datetime] = None
    note: Optional[str] = None

class InsulinInput(BaseModel):
    units: float
    kind: str = "bolus"
    insulin_name: Optional[str] = "humalog"
    timestamp: Optional[datetime] = None
    injected_at: Optional[datetime] = None
    note: Optional[str] = None

class ProfileModel(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    age: Optional[int] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    diabetes_years: Optional[float] = None
    ic_ratio: Optional[float] = None
    isf: Optional[float] = None
    target_glucose: Optional[float] = None
    target_low: Optional[float] = None
    target_high: Optional[float] = None
    tir_goal: Optional[float] = None
    doctor_name: Optional[str] = None
    doctor_email: Optional[str] = None
    glucose_unit: Optional[str] = None
    profile_completed: Optional[bool] = None

class CGMCredentials(BaseModel):
    email: str
    password: str

# 7. Endpoints Glycémie (POST + GET + DELETE)
@api_router.post("/glucose")
async def add_glucose(data: GlucoseInput):
    val = data.value if data.value is not None else data.value_mgdl
    ts = data.timestamp if data.timestamp is not None else data.measured_at
    if not ts:
        ts = datetime.now(timezone.utc)
    doc = {
        "value": val,
        "unit": data.unit,
        "timestamp": ts,
        "source": data.source,
        "note": data.note
    }
    result = await db.glucose_readings.insert_one(doc)
    return {"message": "Mesure ajoutée", "id": str(result.inserted_id)}

@api_router.get("/glucose")
async def get_glucose(limit: int = Query(30, ge=1, le=1000)):
    cursor = db.glucose_readings.find().sort("timestamp", -1).limit(limit)
    readings = []
    async for doc in cursor:
        doc["id"] = str(doc.pop("_id"))
        readings.append(doc)
    return readings

@api_router.delete("/glucose/{item_id}")
async def delete_glucose(item_id: str):
    try:
        obj_id = ObjectId(item_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")
    
    result = await db.glucose_readings.delete_one({"_id": obj_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    return {"message": "Glycémie supprimée avec succès"}

# 8. Endpoints Insuline (POST + GET + DELETE)
@api_router.post("/insulin")
async def add_insulin(data: InsulinInput):
    ts = data.timestamp if data.timestamp is not None else data.injected_at
    if not ts:
        ts = datetime.now(timezone.utc)
    doc = {
        "units": data.units,
        "kind": data.kind,
        "insulin_name": data.insulin_name,
        "timestamp": ts,
        "note": data.note
    }
    result = await db.insulin_doses.insert_one(doc)
    return {"message": "Dose d'insuline ajoutée", "id": str(result.inserted_id)}

@api_router.get("/insulin")
async def get_insulin(limit: int = Query(300, ge=1, le=1000)):
    cursor = db.insulin_doses.find().sort("timestamp", -1).limit(limit)
    doses = []
    async for doc in cursor:
        doc["id"] = str(doc.pop("_id"))
        doses.append(doc)
    return doses

@api_router.delete("/insulin/{item_id}")
async def delete_insulin(item_id: str):
    try:
        obj_id = ObjectId(item_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")
    
    result = await db.insulin_doses.delete_one({"_id": obj_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    return {"message": "Dose d'insuline supprimée avec succès"}

# 9. Endpoint Journal Combiné (Glycémie + Insuline groupées par proximité temporelle)
@api_router.get("/journal")
async def get_journal(limit: int = Query(50, ge=1, le=1000)):
    # Récupération des glycémies
    glucose_cursor = db.glucose_readings.find().sort("timestamp", -1).limit(limit)
    glucose_items = []
    async for doc in glucose_cursor:
        ts = doc.get("timestamp") or doc.get("measured_at")
        glucose_items.append({
            "id": str(doc["_id"]),
            "type": "glucose",
            "value": doc.get("value") if doc.get("value") is not None else doc.get("value_mgdl"),
            "unit": doc.get("unit", "mg/dL"),
            "timestamp": ts,
            "source": doc.get("source", "manuel"),
            "note": doc.get("note")
        })

    # Récupération des doses d'insuline
    insulin_cursor = db.insulin_doses.find().sort("timestamp", -1).limit(limit)
    insulin_items = []
    async for doc in insulin_cursor:
        ts = doc.get("timestamp") or doc.get("injected_at")
        insulin_items.append({
            "id": str(doc["_id"]),
            "type": "insulin",
            "units": doc.get("units"),
            "kind": doc.get("kind", "bolus"),
            "insulin_name": doc.get("insulin_name", "humalog"),
            "timestamp": ts,
            "note": doc.get("note")
        })

    # Fusion et association par proximité temporelle (ou horodatage exact)
    combined = []
    processed_insulin_ids = set()

    for g in glucose_items:
        g_time = g["timestamp"]
        matched_insulin = None
        
        if g_time:
            for ins in insulin_items:
                if ins["id"] not in processed_insulin_ids and ins["timestamp"]:
                    # Si l'écart est inférieur à 1 minute (ou même timestamp)
                    diff = abs((g_time - ins["timestamp"]).total_seconds())
                    if diff < 60:
                        matched_insulin = ins
                        processed_insulin_ids.add(ins["id"])
                        break

        combined.append({
            "id": f"combo_{g['id']}",
            "timestamp": g_time,
            "glucose": g,
            "insulin": matched_insulin,
            "note": g["note"] or (matched_insulin.get("note") if matched_insulin else None)
        })

    # Ajouter les insulines restantes qui n'ont pas trouvé de glycémie associée
    for ins in insulin_items:
        if ins["id"] not in processed_insulin_ids:
            combined.append({
                "id": f"insulin_only_{ins['id']}",
                "timestamp": ins["timestamp"],
                "glucose": None,
                "insulin": ins,
                "note": ins["note"]
            })

    # Tri global du journal par date décroissante
    combined.sort(key=lambda x: x["timestamp"] if x["timestamp"] else datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    
    return combined[:limit]

# 10. Endpoint Statistiques
@api_router.get("/stats")
async def get_stats(days: int = Query(7, ge=1)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    cursor = db.glucose_readings.find({"timestamp": {"$gte": since}})
    readings = [doc["value"] async for doc in cursor if doc.get("value") is not None]

    if not readings:
        cursor = db.glucose_readings.find()
        readings = [doc["value"] async for doc in cursor if doc.get("value") is not None]

    if not readings:
        return {"average": 0, "min": 0, "max": 0, "count": 0, "period_days": days}

    return {
        "average": round(sum(readings) / len(readings), 1),
        "min": min(readings),
        "max": max(readings),
        "count": len(readings),
        "period_days": days,
    }

# 11. Endpoints Profil (GET + PUT + POST)
@api_router.get("/profile")
async def get_profile():
    profile = await db.profiles.find_one()
    if not profile:
        return DEFAULT_PROFILE
    profile["id"] = str(profile.pop("_id"))
    return {**DEFAULT_PROFILE, **profile}

@api_router.put("/profile")
@api_router.post("/profile")
async def save_profile(data: ProfileModel):
    payload = {k: v for k, v in data.model_dump().items() if v is not None}
    if payload:
        await db.profiles.update_one({}, {"$set": payload}, upsert=True)
    profile = await db.profiles.find_one()
    if profile:
        profile["id"] = str(profile.pop("_id"))
        return {**DEFAULT_PROFILE, **profile}
    return DEFAULT_PROFILE

# 12. Endpoints CGM LibreLinkUp
@api_router.post("/cgm/test")
async def test_cgm_connection(credentials: CGMCredentials):
    return {"status": "success", "message": "Connexion établie (simulation)"}

@api_router.post("/cgm/settings")
async def save_cgm_settings(credentials: CGMCredentials):
    doc = credentials.model_dump()
    await db.cgm_settings.update_one({}, {"$set": doc}, upsert=True)
    return {"status": "success", "message": "Paramètres enregistrés"}

# 13. Inclusion des routeurs
app.include_router(auth_router, prefix="/api")
app.include_router(api_router, prefix="/api")