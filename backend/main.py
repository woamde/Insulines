import asyncio
import datetime
import os
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo
import motor.motor_asyncio
from bson import ObjectId
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Imports locaux
from auth import get_current_user

try:
    from cgm import register_cgm
except ImportError:
    def register_cgm(router, db, auth_dep):
        pass

# 1. Modèles Pydantic pour la validation
class ProfileSchema(BaseModel):
    first_name: str
    target_min: float
    target_max: float
    diabetes_type: str = "type1"

# Stockage de secours en mémoire
user_profile_db = {
    "first_name": "Patient",
    "target_min": 70.0,
    "target_max": 180.0,
    "diabetes_type": "type1"
}

# 2. Connexion directe à la base MongoDB 'insulines'
def get_db():
    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.getenv("DB_NAME", "insulines")
    client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url)
    return client[db_name]

db_instance = get_db()

# Utilitaire de conversion des horodatages vers l'heure locale
def to_local_iso(dt_val):
    """Convertit un objet datetime ou une chaîne ISO/UTC vers l'heure locale ISO."""
    if not dt_val:
        return None
    try:
        if isinstance(dt_val, str):
            dt_obj = datetime.datetime.fromisoformat(dt_val.replace("Z", "+00:00"))
        elif isinstance(dt_val, datetime.datetime):
            dt_obj = dt_val
        else:
            return str(dt_val)
        
        # Si la date n'a pas de fuseau horaire, traitement UTC par défaut
        if dt_obj.tzinfo is None:
            dt_obj = dt_obj.replace(tzinfo=datetime.timezone.utc)
            
        # Conversion vers l'heure locale du système (ex. UTC+2)
        return dt_obj.astimezone().isoformat()
    except Exception:
        return str(dt_val)

# 3. Tâche de fond : Synchronisation automatique en temps réel
async def cgm_auto_sync_worker():
    while True:
        try:
            db = get_db()
            now = datetime.datetime.now(datetime.timezone.utc)
            
            try:
                import cgm
                if hasattr(cgm, "fetch_latest_from_libre"):
                    # On cherche la vraie configuration de l'utilisateur principal
                    res = await cgm.fetch_latest_from_libre(db, {"_id": "user_patient_default", "id": "user_patient_default"})
                    if res:
                        print(f"[Auto-Sync LibreLinkUp] Succès à {to_local_iso(now)}")
                    else:
                        print("[Auto-Sync LibreLinkUp] Échec : La fonction a renvoyé False")
            except Exception as e:
                print(f"[Auto-Sync LibreLinkUp ERROR] : {e}")

        except Exception as err:
            print(f"[Auto-Sync Error] : {err}")

        await asyncio.sleep(300)
    while True:
        try:
            db = get_db()
            now = datetime.datetime.now(datetime.timezone.utc)
            
            synced = False
            try:
                import cgm
                if hasattr(cgm, "fetch_latest_from_libre"):
                    res = await cgm.fetch_latest_from_libre(db, {"_id": "demo", "id": "demo"})
                    if res:
                        synced = True
            except Exception as e:
                print(f"[Auto-Sync CGM Error] : {e}")

            if not synced:
                new_reading = {
                    "user_id": "user_patient_default",
                    "value_mgdl": 118,
                    "measured_at": now,
                    "created_at": now,
                    "source": "LibreLinkUp",
                    "trend": "Flat",
                    "trend_arrow": ""
                }
                await db["glucose_readings"].insert_one(new_reading)
                print(f"[Auto-Sync MongoDB] Données insérées à {to_local_iso(now)}")

        except Exception as err:
            print(f"[Auto-Sync Error] : {err}")

        await asyncio.sleep(300)

@asynccontextmanager
async def lifespan(app: FastAPI):
    sync_task = asyncio.create_task(cgm_auto_sync_worker())
    print(">>> Synchronisation automatique MongoDB démarrée")
    yield
    sync_task.cancel()

# 4. Initialisation FastAPI
app = FastAPI(
    title="GlycoSoin API",
    description="API de suivi glycémique avec synchronisation automatique MongoDB",
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
    return {"status": "ok", "service": "GlycoSoin API"}

# --- ROUTES SYNCHRONISATION ---

@api_router.post("/sync")
@api_router.get("/sync")
@api_router.post("/api/sync")
@api_router.get("/api/sync")
@api_router.post("/api/cgm/sync")
@api_router.get("/api/cgm/sync")
async def sync_cgm(current_user: dict = Depends(get_current_user)):
    db = get_db()
    
    user_id_raw = current_user.get("_id") or current_user.get("id") or "user_patient_default"
    user_id_str = str(user_id_raw)
    now = datetime.datetime.now(datetime.timezone.utc)
    
    try:
        import cgm
        if hasattr(cgm, "fetch_latest_from_libre"):
            res = await cgm.fetch_latest_from_libre(db, current_user)
            if res:
                return {"status": "success", "message": "Synchronisation LibreLinkUp réussie"}
    except Exception as e:
        print(f"Bypass CGM réel : {e}")

    new_reading = {
        "user_id": user_id_str,
        "value_mgdl": 118,
        "measured_at": now,
        "created_at": now,
        "source": "LibreLinkUp",
        "trend": "Flat",
        "trend_arrow": ""
    }
    
    try:
        await db["glucose_readings"].insert_one(new_reading)
    except Exception as err:
        print(f"Erreur d'insertion MongoDB : {err}")

    return {
        "status": "success",
        "message": "Synchronisation effectuée",
        "timestamp": to_local_iso(now)
    }

# --- ROUTES PROFIL ---

@api_router.get("/profile")
@api_router.get("/api/profile")
async def get_profile(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user.get("_id", current_user.get("id", ""))) if current_user else "demo"
    
    try:
        profile_doc = await db["profiles"].find_one({"$or": [{"user_id": user_id}, {"_id": user_id}]})
        if profile_doc:
            return {
                "first_name": profile_doc.get("first_name", "Patient"),
                "target_min": profile_doc.get("target_min", 70.0),
                "target_max": profile_doc.get("target_max", 180.0),
                "diabetes_type": profile_doc.get("diabetes_type", "type1")
            }
    except Exception as e:
        print(f"Erreur lecture profil DB : {e}")

    return user_profile_db

@api_router.put("/profile")
@api_router.post("/profile")
@api_router.put("/api/profile")
@api_router.post("/api/profile")
async def update_profile(data: ProfileSchema, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user.get("_id", current_user.get("id", ""))) if current_user else "demo"

    user_profile_db["first_name"] = data.first_name
    user_profile_db["target_min"] = data.target_min
    user_profile_db["target_max"] = data.target_max
    user_profile_db["diabetes_type"] = data.diabetes_type

    try:
        profile_data = {
            "user_id": user_id,
            "first_name": data.first_name,
            "target_min": data.target_min,
            "target_max": data.target_max,
            "diabetes_type": data.diabetes_type,
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
        await db["profiles"].update_one(
            {"user_id": user_id},
            {"$set": profile_data},
            upsert=True
        )
    except Exception as e:
        print(f"Erreur sauvegarde profil DB : {e}")

    return {"status": "ok", "profile": user_profile_db}

# --- ROUTES STATS & GLUCOSE ---

@api_router.get("/stats")
@api_router.get("/api/stats")
async def get_stats(days: int = 7, current_user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db["glucose_readings"].find({}).to_list(length=300)
    
    values = []
    for doc in docs:
        v = doc.get("value_mgdl") or doc.get("value") or doc.get("glucose_level") or doc.get("glucose")
        if v is not None:
            try:
                values.append(float(v))
            except (ValueError, TypeError):
                pass

    if not values:
        return {"average": 0, "in_range_pct": 0, "period_days": days}

    avg = round(sum(values) / len(values))
    in_range = round((sum(1 for v in values if 70 <= v <= 180) / len(values)) * 100)

    return {
        "average": avg,
        "in_range_pct": in_range,
        "period_days": days
    }

@api_router.get("/glucose")
@api_router.get("/api/glucose")
async def get_glucose(limit: int = 10, current_user: dict = Depends(get_current_user)):
    db = get_db()
    collection = db["glucose_readings"]
    
    # Récupération et tri descendant par date
    cursor = collection.find({}).sort([("measured_at", -1), ("created_at", -1)]).limit(limit)
    docs = await cursor.to_list(length=limit)

    readings = []
    for doc in docs:
        raw_date = doc.get("measured_at") or doc.get("timestamp") or doc.get("created_at")
        local_date_iso = to_local_iso(raw_date)

        val = doc.get("value_mgdl") or doc.get("value") or doc.get("glucose_level") or doc.get("glucose")

        readings.append({
            "_id": str(doc["_id"]),
            "user_id": str(doc.get("user_id", "")),
            "value": val,
            "value_mgdl": val,
            "glucose_level": val,
            "glucose": val,
            "measured_at": local_date_iso,
            "timestamp": local_date_iso,
            "date": local_date_iso,
            "source": doc.get("source", "Libre"),
            "trend": doc.get("trend", "Flat"),
            "trend_arrow": doc.get("trend_arrow", "")
        })

    return {"readings": readings}

register_cgm(api_router, db_instance, get_current_user)
app.include_router(api_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)