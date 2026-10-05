import logging
from datetime import datetime, timezone, timedelta
from dateutil import parser
import traceback
from typing import Optional

logger = logging.getLogger(__name__)

def parse_libre_date(date_raw) -> datetime:
    if isinstance(date_raw, datetime):
        dt = date_raw
    else:
        if not date_raw:
            return datetime.now(timezone.utc)
        try:
            dt = parser.parse(str(date_raw))
        except Exception:
            return datetime.now(timezone.utc)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt

async def save_libre_reading(db, reading_data: dict, user_id="user_1bb1122538d1"):
    if isinstance(user_id, dict):
        uid = str(user_id.get("user_id") or user_id.get("_id") or user_id.get("id") or "user_1bb1122538d1")
    else:
        uid = str(user_id or "user_1bb1122538d1")

    raw_ts = (
        reading_data.get("Timestamp")
        or reading_data.get("FactoryTimestamp")
        or reading_data.get("ValueTimestamp")
        or reading_data.get("measured_at")
        or reading_data.get("unix_timestamp")
    )
    measured_at = parse_libre_date(raw_ts)

    raw_val = (
        reading_data.get("Value")
        if reading_data.get("Value") is not None
        else reading_data.get("ValueInMgPerDl", reading_data.get("value_mgdl", reading_data.get("value", 0)))
    )
    try:
        value_mgdl = float(raw_val)
    except (TypeError, ValueError):
        value_mgdl = 0.0

    now = datetime.now(timezone.utc)

    doc = {
        "user_id": uid,
        "value_mgdl": value_mgdl,
        "measured_at": measured_at,
        "created_at": now,
        "source": "LibreLinkUp",
        "trend": str(reading_data.get("TrendArrow", reading_data.get("trend", "Flat"))),
        "trend_arrow": str(reading_data.get("TrendMessage", reading_data.get("trend_arrow", "→"))),
        "external_id": f"{uid}:libre:{int(measured_at.timestamp())}"
    }

    await db["glucose_readings"].update_one(
        {"user_id": uid, "measured_at": measured_at},
        {"$set": doc},
        upsert=True
    )
    return doc

def fetch_libre_from_api(doc):
    from pylibrelinkup import PyLibreLinkUp
    import os

    email = doc.get("email") or doc.get("username") or os.getenv("LIBRE_EMAIL")
    password = doc.get("password") or os.getenv("LIBRE_PASSWORD")

    if not email or not password:
        logger.warning("Identifiants LibreLinkUp manquants.")
        return []

    try:
        client = PyLibreLinkUp(email=email, password=password)
        client.authenticate()
        
        patients = client.get_patients()
        if not patients:
            return []

        all_readings = []
        for patient in patients:
            latest = client.latest(patient_identifier=patient)
            if latest:
                all_readings.append({
                    "ts": getattr(latest, "timestamp", None) or getattr(latest, "factory_timestamp", None),
                    "value": getattr(latest, "value_in_mg_per_dl", None) or getattr(latest, "value", 0),
                    "trend": getattr(latest, "trend", "Flat")
                })
                
            graph_data = client.graph(patient_identifier=patient)
            if graph_data:
                for m in graph_data:
                    all_readings.append({
                        "ts": getattr(m, "timestamp", None) or getattr(m, "factory_timestamp", None),
                        "value": getattr(m, "value_in_mg_per_dl", None) or getattr(m, "value", 0),
                        "trend": getattr(m, "trend", "Flat")
                    })

        return all_readings
    except Exception as e:
        logger.error("Erreur de connexion à l'API LibreLinkUp : %s", e)
        return []

async def fetch_latest_from_libre(db, current_user):
    from fastapi.concurrency import run_in_threadpool

    if isinstance(current_user, dict):
        uid = str(current_user.get("user_id") or current_user.get("_id") or current_user.get("id") or "user_1bb1122538d1")
    else:
        uid = str(current_user or "user_1bb1122538d1")

    doc = await db["cgm_settings"].find_one({"user_id": uid, "deleted_at": None})
    if not doc:
        doc = await db["cgm_settings"].find_one({"deleted_at": None}) or {}

    try:
        readings = await run_in_threadpool(fetch_libre_from_api, doc)
        if not readings:
            return False

        for r in readings:
            await save_libre_reading(
                db,
                {
                    "Timestamp": r["ts"],
                    "Value": r["value"],
                    "TrendArrow": r.get("trend", "Flat"),
                },
                user_id=uid
            )
        return True
    except Exception as e:
        logger.error("Erreur détaillée de synchronisation Libre : %s", e)
        return False

def register_cgm(router, db, auth_dep):
    from fastapi import HTTPException
    from pydantic import BaseModel
    from fastapi.concurrency import run_in_threadpool

    class CgmSettingsSchema(BaseModel):
        email: Optional[str] = None
        password: Optional[str] = None
        username: Optional[str] = None
        source: Optional[str] = "libre"
        region: Optional[str] = "fr"
        nightscout_url: Optional[str] = None
        token: Optional[str] = None

    @router.post("/cgm/settings")
    async def save_cgm_settings(data: CgmSettingsSchema):
        user_id = "user_1bb1122538d1"
        settings = {
            "user_id": user_id,
            "email": data.email or data.username,
            "password": data.password,
            "source": data.source,
            "region": data.region,
            "deleted_at": None,
            "updated_at": datetime.now(timezone.utc)
        }
        await db["cgm_settings"].update_one({"user_id": user_id}, {"$set": settings}, upsert=True)
        return {"status": "success", "message": "Paramètres CGM enregistrés"}

    @router.post("/cgm/test")
    async def test_cgm_settings(data: CgmSettingsSchema):
        email = data.email or data.username
        password = data.password

        if not email or not password:
            raise HTTPException(status_code=400, detail="Email et mot de passe requis pour le test.")

        try:
            temp_doc = {"email": email, "password": password}
            readings = await run_in_threadpool(fetch_libre_from_api, temp_doc)

            latest_val = readings[0].get("value") if readings else None
            latest_time = readings[0].get("ts") if readings else None

            return {
                "ok": True,
                "readings": len(readings),
                "patients": [],
                "selected_patient": email,
                "latest_value": latest_val,
                "latest_at": str(latest_time) if latest_time else None,
                "message": f"Connexion réussie ! {len(readings)} relevés trouvés."
            }
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Échec de la connexion : {str(e)}")