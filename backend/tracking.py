"""Suivi complémentaire : injections d'insuline (basale/bolus), poids, rappels."""
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

INSULIN_KINDS = {"basale", "bolus", "correction"}
REMINDER_KINDS = {"glucose", "basale"}

DEFAULT_REMINDERS = [
    {"id": "reveil", "label": "Au réveil (à jeun)", "hour": 7, "minute": 30, "enabled": True, "kind": "glucose"},
    {"id": "dejeuner", "label": "Avant le déjeuner", "hour": 12, "minute": 0, "enabled": True, "kind": "glucose"},
    {"id": "diner", "label": "Avant le dîner", "hour": 19, "minute": 0, "enabled": True, "kind": "glucose"},
    {"id": "coucher", "label": "Au coucher", "hour": 22, "minute": 30, "enabled": True, "kind": "glucose"},
    {"id": "basale", "label": "Insuline lente (basale)", "hour": 21, "minute": 0, "enabled": True, "kind": "basale"},
]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value) -> Optional[str]:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def serialize(doc: dict, date_fields: tuple[str, ...]) -> dict:
    out = {k: v for k, v in doc.items() if k not in ("_id", "user_id", "deleted_at")}
    out["id"] = str(doc["_id"])
    for f in date_fields:
        if f in out:
            out[f] = _iso(out[f])
    return out


def parse_oid(raw: str) -> ObjectId:
    try:
        return ObjectId(raw)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="Identifiant invalide")


class InsulinCreate(BaseModel):
    units: float
    kind: str = "basale"
    insulin_name: str = ""
    note: str = ""
    injected_at: Optional[datetime] = None


class WeightCreate(BaseModel):
    weight_kg: float
    note: str = ""
    measured_at: Optional[datetime] = None


class Reminder(BaseModel):
    id: str
    label: str
    hour: int
    minute: int
    enabled: bool = True
    kind: str = "glucose"


class RemindersIn(BaseModel):
    reminders: List[Reminder]


ACTIVITY_TYPES = {"marche", "course", "velo", "natation", "musculation", "autre"}
ACTIVITY_INTENSITIES = {"legere", "moderee", "intense"}


class ActivityCreate(BaseModel):
    activity_type: str = "marche"
    duration_min: int
    intensity: str = "moderee"
    note: str = ""
    started_at: Optional[datetime] = None


class ShareCreate(BaseModel):
    label: str = ""
    alert_email: str = ""


class ShareUpdate(BaseModel):
    alert_email: str = ""


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
HYPO_ALERT_COOLDOWN_MIN = 60


async def notify_hypo_if_needed(db, user_id: str, value_mgdl: float, measured_at: datetime) -> int:
    """Envoie une alerte e-mail aux proches (liens de partage avec e-mail) si la glycémie est sous la cible basse.

    Une alerte au plus par lien et par heure ; mesure de plus de 2 h ignorée (imports, rattrapage CGM).
    """
    from html import escape
    from report import send_report_email

    if measured_at.tzinfo is None:
        measured_at = measured_at.replace(tzinfo=timezone.utc)
    if now_utc() - measured_at > timedelta(hours=2):
        return 0
    profile = await db.profiles.find_one({"user_id": user_id}) or {}
    low_t = float(profile.get("target_low") or 70)
    if value_mgdl >= low_t:
        return 0
    links = await db.share_links.find({"user_id": user_id, "revoked_at": None, "alert_email": {"$nin": [None, ""]}}).to_list(10)
    if not links:
        return 0
    owner = await db.users.find_one({"user_id": user_id}) or {}
    name = profile.get("name") if profile.get("name") and profile.get("name") != "Profil" else (owner.get("name") or "votre proche")
    unit_mmol = (profile.get("glucose_unit") == "mmol")
    shown = f"{value_mgdl / 18.016:.1f} mmol/L".replace(".", ",") if unit_mmol else f"{round(value_mgdl)} mg/dL"
    severe = value_mgdl < 54
    sent = 0
    for link in links:
        last = link.get("last_alert_at")
        if last and now_utc() - (last if last.tzinfo else last.replace(tzinfo=timezone.utc)) < timedelta(minutes=HYPO_ALERT_COOLDOWN_MIN):
            continue
        subject = f"{'Hypoglycémie sévère' if severe else 'Hypoglycémie'} — {name} : {shown}"
        html = (
            '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#0F172A">'
            f'<p>Bonjour {escape(link.get("label") or "")},</p>'
            f"<p><strong>{escape(str(name))}</strong> vient d'enregistrer une glycémie basse : <strong style=\"color:#DC2626;font-size:20px\">{shown}</strong> "
            f'(sous sa cible basse de {round(low_t)} mg/dL).</p>'
            "<p>" + ("Il s'agit d'une hypoglycémie sévère : prenez contact sans attendre. " if severe else "") +
            f'Assurez-vous que {escape(str(name))} prend des sucres rapides (15 g) et recontrôle dans 15 minutes. '
            f'En cas de malaise, confusion ou perte de connaissance, appelez le 15 ou le 112.</p>'
            f'<p style="font-size:12px;color:#64748B">Alerte envoyée par GlycoSoin T1D à la demande de {escape(str(name))}. '
            f'Au plus une alerte par heure.</p></td></tr></table>'
        )
        try:
            await send_report_email(to=link["alert_email"], subject=subject, html=html)
            await db.share_links.update_one({"_id": link["_id"]}, {"$set": {"last_alert_at": now_utc()}, "$inc": {"alerts_sent": 1}})
            sent += 1
        except Exception as e:  # l'alerte ne doit jamais bloquer l'enregistrement de la glycémie
            logging.getLogger(__name__).warning("Alerte hypo non envoyée: %s", e)
    return sent


def _glucose_effect(readings: list[dict], start: datetime, duration_min: int) -> dict:
    """Glycémie moyenne dans les 2 h avant l'activité vs les 2 h après sa fin."""
    end = start + timedelta(minutes=duration_min)
    before = [r["value_mgdl"] for r in readings if start - timedelta(hours=2) <= r["measured_at"] < start]
    after = [r["value_mgdl"] for r in readings if end < r["measured_at"] <= end + timedelta(hours=2)]
    avg_b = round(sum(before) / len(before)) if before else None
    avg_a = round(sum(after) / len(after)) if after else None
    return {
        "before_avg": avg_b,
        "after_avg": avg_a,
        "delta": (avg_a - avg_b) if (avg_a is not None and avg_b is not None) else None,
        "hypo_after": any(v < 70 for v in after),
    }


def register_tracking(api_router: APIRouter, db, get_current_user) -> None:
    # ------------------------------------------------------------------ Insuline
    @api_router.post("/insulin")
    async def add_insulin(payload: InsulinCreate, user: dict = Depends(get_current_user)):
        if payload.units <= 0 or payload.units > 200:
            raise HTTPException(status_code=400, detail="Dose d'insuline invalide (0–200 U)")
        if payload.kind not in INSULIN_KINDS:
            raise HTTPException(status_code=400, detail="Type d'insuline invalide")
        doc = {
            "user_id": user["user_id"],
            "units": round(payload.units, 1),
            "kind": payload.kind,
            "insulin_name": payload.insulin_name.strip(),
            "note": payload.note.strip(),
            "injected_at": payload.injected_at or now_utc(),
            "deleted_at": None,
            "created_at": now_utc(),
        }
        res = await db.insulin_doses.insert_one(doc)
        doc["_id"] = res.inserted_id
        return serialize(doc, ("injected_at", "created_at"))

    @api_router.get("/insulin")
    async def list_insulin(limit: int = 200, user: dict = Depends(get_current_user)):
        docs = (
            await db.insulin_doses.find({"user_id": user["user_id"], "deleted_at": None})
            .sort("injected_at", -1)
            .to_list(limit)
        )
        return [serialize(d, ("injected_at", "created_at")) for d in docs]

    @api_router.delete("/insulin/{dose_id}")
    async def delete_insulin(dose_id: str, user: dict = Depends(get_current_user)):
        await db.insulin_doses.update_one(
            {"_id": parse_oid(dose_id), "user_id": user["user_id"]}, {"$set": {"deleted_at": now_utc()}}
        )
        return {"ok": True}

    # --------------------------------------------------------------------- Poids
    @api_router.post("/weight")
    async def add_weight(payload: WeightCreate, user: dict = Depends(get_current_user)):
        if payload.weight_kg < 20 or payload.weight_kg > 400:
            raise HTTPException(status_code=400, detail="Poids invalide (20–400 kg)")
        uid = user["user_id"]
        doc = {
            "user_id": uid,
            "weight_kg": round(payload.weight_kg, 1),
            "note": payload.note.strip(),
            "measured_at": payload.measured_at or now_utc(),
            "deleted_at": None,
            "created_at": now_utc(),
        }
        res = await db.weight_entries.insert_one(doc)
        doc["_id"] = res.inserted_id
        # Le profil reflète toujours le dernier poids saisi
        await db.profiles.update_one(
            {"user_id": uid},
            {"$set": {"weight_kg": doc["weight_kg"], "updated_at": now_utc()}, "$setOnInsert": {"user_id": uid, "created_at": now_utc()}},
            upsert=True,
        )
        return serialize(doc, ("measured_at", "created_at"))

    @api_router.get("/weight")
    async def list_weight(limit: int = 200, user: dict = Depends(get_current_user)):
        docs = (
            await db.weight_entries.find({"user_id": user["user_id"], "deleted_at": None})
            .sort("measured_at", -1)
            .to_list(limit)
        )
        return [serialize(d, ("measured_at", "created_at")) for d in docs]

    @api_router.delete("/weight/{entry_id}")
    async def delete_weight(entry_id: str, user: dict = Depends(get_current_user)):
        await db.weight_entries.update_one(
            {"_id": parse_oid(entry_id), "user_id": user["user_id"]}, {"$set": {"deleted_at": now_utc()}}
        )
        return {"ok": True}

    # ------------------------------------------------------------------- Rappels
    @api_router.get("/reminders")
    async def get_reminders(user: dict = Depends(get_current_user)):
        doc = await db.reminders.find_one({"user_id": user["user_id"]}, {"_id": 0, "reminders": 1})
        return {"reminders": doc["reminders"] if doc else DEFAULT_REMINDERS}

    @api_router.put("/reminders")
    async def save_reminders(payload: RemindersIn, user: dict = Depends(get_current_user)):
        for r in payload.reminders:
            if not (0 <= r.hour <= 23 and 0 <= r.minute <= 59):
                raise HTTPException(status_code=400, detail=f"Heure invalide pour « {r.label} »")
            if r.kind not in REMINDER_KINDS:
                raise HTTPException(status_code=400, detail="Type de rappel invalide")
        reminders = [r.model_dump() for r in payload.reminders]
        await db.reminders.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"reminders": reminders, "updated_at": now_utc()}},
            upsert=True,
        )
        return {"reminders": reminders}

    # ---------------------------------------------------------------- Activité
    @api_router.post("/activity")
    async def add_activity(payload: ActivityCreate, user: dict = Depends(get_current_user)):
        if payload.activity_type not in ACTIVITY_TYPES:
            raise HTTPException(status_code=400, detail="Type d'activité invalide")
        if payload.intensity not in ACTIVITY_INTENSITIES:
            raise HTTPException(status_code=400, detail="Intensité invalide")
        if payload.duration_min < 5 or payload.duration_min > 600:
            raise HTTPException(status_code=400, detail="Durée invalide (5–600 min)")
        started = payload.started_at or (now_utc() - timedelta(minutes=payload.duration_min))
        doc = {
            "user_id": user["user_id"],
            "activity_type": payload.activity_type,
            "duration_min": payload.duration_min,
            "intensity": payload.intensity,
            "note": payload.note.strip(),
            "started_at": started,
            "deleted_at": None,
            "created_at": now_utc(),
        }
        res = await db.activities.insert_one(doc)
        doc["_id"] = res.inserted_id
        return serialize(doc, ("started_at", "created_at"))

    @api_router.get("/activity")
    async def list_activity(limit: int = 100, user: dict = Depends(get_current_user)):
        uid = user["user_id"]
        docs = await db.activities.find({"user_id": uid, "deleted_at": None}).sort("started_at", -1).to_list(limit)
        if not docs:
            return []
        oldest = min(d["started_at"] for d in docs) - timedelta(hours=2)
        readings = await db.glucose_readings.find(
            {"user_id": uid, "deleted_at": None, "measured_at": {"$gte": oldest}}, {"value_mgdl": 1, "measured_at": 1}
        ).to_list(20000)
        out = []
        for d in docs:
            item = serialize(d, ("started_at", "created_at"))
            item["effect"] = _glucose_effect(readings, d["started_at"], d["duration_min"])
            out.append(item)
        return out

    @api_router.delete("/activity/{activity_id}")
    async def delete_activity(activity_id: str, user: dict = Depends(get_current_user)):
        await db.activities.update_one(
            {"_id": parse_oid(activity_id), "user_id": user["user_id"]}, {"$set": {"deleted_at": now_utc()}}
        )
        return {"ok": True}

    # ------------------------------------------------------------ Partage proche
    @api_router.post("/share")
    async def create_share(payload: ShareCreate, user: dict = Depends(get_current_user)):
        uid = user["user_id"]
        count = await db.share_links.count_documents({"user_id": uid, "revoked_at": None})
        if count >= 5:
            raise HTTPException(status_code=400, detail="Maximum 5 liens de partage actifs")
        alert_email = payload.alert_email.strip().lower()
        if alert_email and not EMAIL_RE.match(alert_email):
            raise HTTPException(status_code=400, detail="Adresse e-mail d'alerte invalide")
        doc = {
            "user_id": uid,
            "token": secrets.token_urlsafe(24),
            "label": payload.label.strip()[:40] or "Proche",
            "alert_email": alert_email,
            "created_at": now_utc(),
            "revoked_at": None,
            "last_viewed_at": None,
            "last_alert_at": None,
            "alerts_sent": 0,
            "views": 0,
        }
        res = await db.share_links.insert_one(doc)
        doc["_id"] = res.inserted_id
        return serialize(doc, ("created_at", "last_viewed_at", "last_alert_at"))

    @api_router.patch("/share/{share_id}")
    async def update_share(share_id: str, payload: ShareUpdate, user: dict = Depends(get_current_user)):
        alert_email = payload.alert_email.strip().lower()
        if alert_email and not EMAIL_RE.match(alert_email):
            raise HTTPException(status_code=400, detail="Adresse e-mail d'alerte invalide")
        res = await db.share_links.update_one(
            {"_id": parse_oid(share_id), "user_id": user["user_id"], "revoked_at": None}, {"$set": {"alert_email": alert_email}}
        )
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Lien introuvable")
        return {"ok": True, "alert_email": alert_email}

    @api_router.get("/share")
    async def list_share(user: dict = Depends(get_current_user)):
        docs = await db.share_links.find({"user_id": user["user_id"], "revoked_at": None}).sort("created_at", -1).to_list(20)
        return [serialize(d, ("created_at", "last_viewed_at", "last_alert_at")) for d in docs]

    @api_router.delete("/share/{share_id}")
    async def revoke_share(share_id: str, user: dict = Depends(get_current_user)):
        await db.share_links.update_one(
            {"_id": parse_oid(share_id), "user_id": user["user_id"]}, {"$set": {"revoked_at": now_utc()}}
        )
        return {"ok": True}

    @api_router.get("/shared/{token}")
    async def shared_view(token: str):
        """Vue publique en lecture seule pour un proche (jeton non devinable, révocable)."""
        if len(token) < 20:
            raise HTTPException(status_code=404, detail="Lien de partage introuvable")
        link = await db.share_links.find_one({"token": token, "revoked_at": None})
        if not link:
            raise HTTPException(status_code=404, detail="Ce lien de partage n'existe plus")
        uid = link["user_id"]
        owner = await db.users.find_one({"user_id": uid, "account_deletion_pending": {"$ne": True}}, {"_id": 0})
        if not owner:
            raise HTTPException(status_code=404, detail="Ce lien de partage n'existe plus")
        await db.share_links.update_one({"_id": link["_id"]}, {"$set": {"last_viewed_at": now_utc()}, "$inc": {"views": 1}})

        profile = await db.profiles.find_one({"user_id": uid}) or {}
        low_t = float(profile.get("target_low") or 70)
        high_t = float(profile.get("target_high") or 180)
        since = now_utc() - timedelta(hours=24)
        readings = await db.glucose_readings.find(
            {"user_id": uid, "deleted_at": None, "measured_at": {"$gte": since}}, {"value_mgdl": 1, "measured_at": 1, "source": 1}
        ).sort("measured_at", 1).to_list(2000)
        latest_doc = await db.glucose_readings.find_one({"user_id": uid, "deleted_at": None}, sort=[("measured_at", -1)])
        previous_doc = await db.glucose_readings.find_one(
            {"user_id": uid, "deleted_at": None, "measured_at": {"$lt": latest_doc["measured_at"]}}, sort=[("measured_at", -1)]
        ) if latest_doc else None
        meals = await db.meals.find({"user_id": uid, "deleted_at": None, "eaten_at": {"$gte": since}}).to_list(200)
        doses = await db.insulin_doses.find({"user_id": uid, "deleted_at": None, "injected_at": {"$gte": since}}).to_list(200)
        values = [r["value_mgdl"] for r in readings]
        n = len(values)
        name = profile.get("name") if profile.get("name") and profile.get("name") != "Profil" else (owner.get("name") or "").split(" ")[0]
        return {
            "owner_name": name or "Votre proche",
            "label": link["label"],
            "unit": profile.get("glucose_unit") or "mgdl",
            "target_low": low_t,
            "target_high": high_t,
            "latest": {
                "value_mgdl": latest_doc["value_mgdl"],
                "measured_at": _iso(latest_doc["measured_at"]),
                "source": latest_doc.get("source", "manuel"),
                "delta": (latest_doc["value_mgdl"] - previous_doc["value_mgdl"]) if previous_doc else None,
            } if latest_doc else None,
            "summary_24h": {
                "readings_count": n,
                "avg": round(sum(values) / n) if n else None,
                "tir_in": round(sum(1 for v in values if low_t <= v <= high_t) / n * 100) if n else None,
                "hypo_count": sum(1 for v in values if v < low_t),
                "hyper_count": sum(1 for v in values if v > high_t),
                "carbs_g": round(sum((m.get("carbs_g") or 0) for m in meals)),
                "bolus_units": round(sum((m.get("insulin_units") or 0) for m in meals) + sum(d["units"] for d in doses if d.get("kind") != "basale"), 1),
                "basal_units": round(sum(d["units"] for d in doses if d.get("kind") == "basale"), 1),
                "meals_count": len(meals),
            },
            "series": [{"value_mgdl": r["value_mgdl"], "measured_at": _iso(r["measured_at"])} for r in readings],
            "generated_at": _iso(now_utc()),
        }
