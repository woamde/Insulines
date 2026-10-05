"""Import d'un export CSV LibreView (glucose_data.csv) — envoyé par lots de lignes depuis l'application."""
import csv
import io
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

TIMESTAMP_FORMATS = (
    "%d-%m-%Y %H:%M",
    "%m-%d-%Y %I:%M %p",
    "%Y-%m-%d %H:%M",
    "%d/%m/%Y %H:%M",
    "%m/%d/%Y %I:%M %p",
    "%d.%m.%Y %H:%M",
)
MMOL_FACTOR = 18.016


class ImportBatch(BaseModel):
    lines: List[str]
    tz: str = "Europe/Paris"
    batch_index: int = 0


def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name or "Europe/Paris")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("Europe/Paris")


def _find_col(headers: List[str], *keywords: str) -> Optional[int]:
    """Index de la 1re colonne dont l'en-tête (minuscules) contient tous les mots-clés."""
    for i, h in enumerate(headers):
        low = h.lower()
        if all(k in low for k in keywords):
            return i
    return None


def _num(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    v = value.strip().replace(",", ".")
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _parse_ts(raw: Optional[str], tz: ZoneInfo) -> Optional[datetime]:
    raw = (raw or "").strip()
    for fmt in TIMESTAMP_FORMATS:
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=tz).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def parse_libreview_lines(lines: List[str], tz_name: str) -> Dict[str, Any]:
    """Retourne {readings:[{measured_at,value_mgdl,kind}], insulin:[...], meals:[...], skipped:int}."""
    tz = _tz(tz_name)
    text = "\n".join(l for l in lines if l is not None)
    rows = list(csv.reader(io.StringIO(text)))
    header_idx = next(
        (
            i for i, r in enumerate(rows)
            if any(
                "record type" in c.lower() or "type d'enregistrement" in c.lower() or "type d’enregistrement" in c.lower()
                for c in r
            )
        ),
        None,
    )
    if header_idx is None:
        raise HTTPException(
            status_code=400,
            detail="En-tête LibreView introuvable : exportez le fichier « glucose_data.csv » depuis LibreView"
        )
    
    headers = rows[header_idx]
    c_ts = _find_col(headers, "timestamp") if _find_col(headers, "timestamp") is not None else _find_col(headers, "horodatage")
    c_type = _find_col(headers, "record type")
    if c_type is None:
        c_type = _find_col(headers, "enregistrement")
    c_hist = _find_col(headers, "historic") if _find_col(headers, "historic") is not None else _find_col(headers, "historique")
    c_scan = _find_col(headers, "scan")
    c_strip = _find_col(headers, "strip") if _find_col(headers, "strip") is not None else _find_col(headers, "bandelette")
    c_rapid = _find_col(headers, "rapid", "unit") if _find_col(headers, "rapid", "unit") is not None else _find_col(headers, "rapide", "unit")
    c_long = _find_col(headers, "long", "unit") if _find_col(headers, "long", "unit") is not None else _find_col(headers, "lente", "unit")
    c_carbs = _find_col(headers, "gram")
    c_notes = _find_col(headers, "note")

    if c_ts is None or c_hist is None:
        raise HTTPException(status_code=400, detail="Colonnes LibreView non reconnues (horodatage / glycémie)")

    mmol = any("mmol" in headers[c].lower() for c in (c_hist, c_scan) if c is not None and c < len(headers))

    readings, insulin, meals, skipped = [], [], [], 0
    for r in rows[header_idx + 1 :]:
        if not r or len(r) <= max(c_ts, c_hist):
            continue
        ts = _parse_ts(r[c_ts], tz)
        if ts is None:
            skipped += 1
            continue
        
        rtype = r[c_type].strip() if c_type is not None and c_type < len(r) else ""
        hist = _num(r[c_hist]) if c_hist < len(r) else None
        scan = _num(r[c_scan]) if c_scan is not None and c_scan < len(r) else None
        strip = _num(r[c_strip]) if c_strip is not None and c_strip < len(r) else None
        
        value = hist if rtype in ("0", "") and hist else (scan if scan else None)
        if value is None and hist:
            value = hist
        if value is not None:
            if mmol:
                value = value * MMOL_FACTOR
            if 20 <= value <= 600:
                readings.append({"measured_at": ts, "value_mgdl": round(value), "kind": "scan" if rtype == "1" else "historic"})
        if strip is not None and 20 <= strip <= 600:
            readings.append({"measured_at": ts, "value_mgdl": round(strip * MMOL_FACTOR if mmol else strip), "kind": "strip"})
        
        rapid = _num(r[c_rapid]) if c_rapid is not None and c_rapid < len(r) else None
        longi = _num(r[c_long]) if c_long is not None and c_long < len(r) else None
        if rapid and rapid > 0:
            insulin.append({"injected_at": ts, "units": round(rapid, 1), "kind": "bolus"})
        if longi and longi > 0:
            insulin.append({"injected_at": ts, "units": round(longi, 1), "kind": "basale"})
        
        carbs = _num(r[c_carbs]) if c_carbs is not None and c_carbs < len(r) else None
        if carbs and carbs > 0:
            note = r[c_notes].strip() if c_notes is not None and c_notes < len(r) else ""
            meals.append({"eaten_at": ts, "carbs_g": round(carbs), "note": note})

    return {"readings": readings, "insulin": insulin, "meals": meals, "skipped": skipped}


def register_import(api_router: APIRouter, db, get_current_user) -> None:
    @api_router.post("/import/libreview")
    async def import_libreview(batch: ImportBatch, user: dict = Depends(get_current_user)):
        if len(batch.lines) > 6000:
            raise HTTPException(status_code=400, detail="Lot trop volumineux (max 6000 lignes)")
        uid = user["user_id"]
        parsed = parse_libreview_lines(batch.lines, batch.tz)
        now = datetime.now(timezone.utc)

        inserted_r = inserted_i = inserted_m = 0

        if parsed["readings"]:
            times = [x["measured_at"] for x in parsed["readings"]]
            existing = await db.glucose_readings.find(
                {"user_id": uid, "deleted_at": None, "measured_at": {"$gte": min(times), "$lte": max(times)}},
                {"measured_at": 1, "value_mgdl": 1},
            ).to_list(100000)
            seen = {(e["measured_at"].replace(second=0, microsecond=0), round(e["value_mgdl"])) for e in existing}
            docs = []
            for x in parsed["readings"]:
                key = (x["measured_at"].replace(second=0, microsecond=0), x["value_mgdl"])
                if key in seen:
                    continue
                seen.add(key)
                docs.append({
                    "user_id": uid,
                    "value_mgdl": float(x["value_mgdl"]),
                    "context": "capteur" if x["kind"] != "strip" else "autre",
                    "note": "Import LibreView",
                    "source": "libre",
                    "external_id": None,
                    "measured_at": x["measured_at"],
                    "deleted_at": None,
                    "created_at": now,
                })
            if docs:
                await db.glucose_readings.insert_many(docs)
                inserted_r = len(docs)

        if parsed["insulin"]:
            times = [x["injected_at"] for x in parsed["insulin"]]
            existing = await db.insulin_doses.find(
                {"user_id": uid, "deleted_at": None, "injected_at": {"$gte": min(times), "$lte": max(times)}},
                {"injected_at": 1, "units": 1},
            ).to_list(50000)
            seen = {(e["injected_at"].replace(second=0, microsecond=0), round(e["units"], 1)) for e in existing}
            docs = []
            for x in parsed["insulin"]:
                key = (x["injected_at"].replace(second=0, microsecond=0), x["units"])
                if key in seen:
                    continue
                seen.add(key)
                docs.append({
                    "user_id": uid,
                    "units": x["units"],
                    "kind": x["kind"],
                    "insulin_name": "",
                    "note": "Import LibreView",
                    "injected_at": x["injected_at"],
                    "deleted_at": None,
                    "created_at": now,
                })
            if docs:
                await db.insulin_doses.insert_many(docs)
                inserted_i = len(docs)

        if parsed["meals"]:
            times = [x["eaten_at"] for x in parsed["meals"]]
            existing = await db.meals.find(
                {"user_id": uid, "deleted_at": None, "eaten_at": {"$gte": min(times), "$lte": max(times)}},
                {"eaten_at": 1, "carbs_g": 1},
            ).to_list(50000)
            seen = {(e["eaten_at"].replace(second=0, microsecond=0), round(e.get("carbs_g") or 0)) for e in existing}
            docs = []
            for x in parsed["meals"]:
                key = (x["eaten_at"].replace(second=0, microsecond=0), x["carbs_g"])
                if key in seen:
                    continue
                seen.add(key)
                docs.append({
                    "user_id": uid,
                    "meal_type": "repas",
                    "name": "Repas (import LibreView)",
                    "items": [],
                    "carbs_g": float(x["carbs_g"]),
                    "glucose_before": None,
                    "insulin_units": None,
                    "photo_path": None,
                    "note": x["note"],
                    "eaten_at": x["eaten_at"],
                    "deleted_at": None,
                    "created_at": now,
                })
            if docs:
                await db.meals.insert_many(docs)
                inserted_m = len(docs)

        logger.info("Import LibreView %s lot %s : %s glycémies, %s insulines, %s repas", uid, batch.batch_index, inserted_r, inserted_i, inserted_m)
        return {
            "readings_parsed": len(parsed["readings"]),
            "readings_inserted": inserted_r,
            "insulin_inserted": inserted_i,
            "meals_inserted": inserted_m,
            "skipped": parsed["skipped"],
        }