import logging
from datetime import datetime, timezone
from dateutil import parser

logger = logging.getLogger(__name__)


def parse_libre_date(date_raw) -> datetime:
    """Convertit n'importe quel timestamp LibreLinkUp en datetime UTC valide."""
    if isinstance(date_raw, datetime):
        if date_raw.tzinfo is None:
            return date_raw.replace(tzinfo=timezone.utc)
        return date_raw.astimezone(timezone.utc)

    if not date_raw:
        return datetime.now(timezone.utc)

    try:
        # Analyse des formats ISO ou chaînes d'Abbott (ex: '10/1/2026 3:50:33 PM' ou ISO)
        dt = parser.parse(str(date_raw))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


async def save_libre_reading(db, reading_data: dict, user_id="user_patient_default"):
    """Insère un relevé réel LibreLinkUp avec une date UTC normalisée dans MongoDB."""
    # Extraction sécurisée de l'ID utilisateur
    if isinstance(user_id, dict):
        uid = str(user_id.get("user_id") or user_id.get("_id") or user_id.get("id") or "user_patient_default")
    else:
        uid = str(user_id or "user_patient_default")

    # Récupération de l'horodatage transmis par LibreLinkUp
    raw_ts = (
        reading_data.get("Timestamp")
        or reading_data.get("FactoryTimestamp")
        or reading_data.get("ValueTimestamp")
        or reading_data.get("measured_at")
    )
    measured_at = parse_libre_date(raw_ts)

    # Récupération et conversion sécurisée de la valeur glycémique
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
        "measured_at": measured_at,  # Objet datetime UTC natif (BSON Date)
        "created_at": now,
        "source": "LibreLinkUp",
        "trend": str(reading_data.get("TrendArrow", reading_data.get("trend", "Flat"))),
        "trend_arrow": str(reading_data.get("TrendMessage", reading_data.get("trend_arrow", ""))),
        "external_id": f"{uid}:libre:{int(measured_at.timestamp())}"
    }

    # Upsert pour éviter les doublons sur le même horodatage
    await db["glucose_readings"].update_one(
        {"user_id": uid, "measured_at": measured_at},
        {"$set": doc},
        upsert=True
    )

    return doc


async def fetch_latest_from_libre(db, current_user):
    """Effectue la synchronisation à la demande appelée par le worker main.py."""
    from fastapi.concurrency import run_in_threadpool

    if isinstance(current_user, dict):
        uid = str(current_user.get("user_id") or current_user.get("_id") or current_user.get("id") or "user_patient_default")
    else:
        uid = str(current_user or "user_patient_default")

    doc = await db["cgm_settings"].find_one({"user_id": uid, "deleted_at": None})
    if not doc or doc.get("source") != "libre":
        return False

    try:
        # Appel direct à fetch_libre (déjà présent dans le fichier)
        readings = await run_in_threadpool(fetch_libre, doc)
        if not readings:
            return False

        # Récupération de la mesure la plus récente
        latest = max(readings, key=lambda r: r["ts"])
        await save_libre_reading(
            db,
            {
                "Timestamp": latest["ts"],
                "Value": latest["value"],
                "TrendArrow": "Flat",
            },
            user_id=uid
        )
        return True
    except Exception as e:
        logger.warning(f"Échec fetch_latest_from_libre pour {uid} : {e}")
        return False
    """Effectue la synchronisation à la demande appelée par le worker main.py."""
    from fastapi.concurrency import run_in_threadpool

    if isinstance(current_user, dict):
        uid = str(current_user.get("user_id") or current_user.get("_id") or current_user.get("id") or "user_patient_default")
    else:
        uid = str(current_user or "user_patient_default")

    doc = await db["cgm_settings"].find_one({"user_id": uid, "deleted_at": None})
    if not doc or doc.get("source") != "libre":
        return False

    try:
        # Import local de la fonction de récupération LibreLinkUp
        from cgm import fetch_libre
        readings = await run_in_threadpool(fetch_libre, doc)
        if not readings:
            return False

        # On prend le relevé le plus récent
        latest = max(readings, key=lambda r: r["ts"])
        await save_libre_reading(
            db,
            {
                "Timestamp": latest["ts"],
                "Value": latest["value"],
                "TrendArrow": "Flat",
            },
            user_id=uid
        )
        return True
    except Exception as e:
        logger.warning(f"Échec fetch_latest_from_libre pour {uid} : {e}")
        return False
    
    