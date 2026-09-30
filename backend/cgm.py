import hashlib
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from tracking import notify_hypo_if_needed
from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Capteurs CGM : Dexcom Share, FreeStyle Libre (LibreLinkUp), Nightscout
# ---------------------------------------------------------------------------
DEXCOM_BASES = {
    "us": "https://share2.dexcom.com/ShareWebServices/Services",
    "ous": "https://shareous1.dexcom.com/ShareWebServices/Services",
    "jp": "https://share.dexcom.com/ShareWebServices/Services",
}
# Identifiant d'application utilisé par les clients Dexcom Share publics (xDrip, Nightscout bridge).
DEXCOM_APPLICATION_ID = os.environ.get("DEXCOM_APPLICATION_ID", "d89459d6-77cc-4f6d-b2a6-4a8b1a0a3f26")

LIBRE_HOSTS = {
    "global": "https://api.libreview.io",
    "eu": "https://api-eu.libreview.io",
    "eu2": "https://api-eu2.libreview.io",
    "us": "https://api-us.libreview.io",
    "fr": "https://api-fr.libreview.io",
    "de": "https://api-de.libreview.io",
    "au": "https://api-au.libreview.io",
    "ap": "https://api-ap.libreview.io",
    "ca": "https://api-ca.libreview.io",
    "jp": "https://api-jp.libreview.io",
    "la": "https://api-la.libreview.io",
    "ru": "https://api.libreview.ru",
    "ae": "https://api-ae.libreview.io",
}

SOURCE_LABELS = {"dexcom": "Dexcom", "libre": "FreeStyle Libre", "nightscout": "Nightscout"}


class CgmError(Exception):
    """Erreur fonctionnelle attendue (identifiants, compte, réseau)."""


def _quoted(text: str):
    try:
        return json.loads(text)
    except Exception:
        return text.strip().strip('"')


def _dexcom_date(value) -> Optional[datetime]:
    m = re.search(r"Date\((\d+)", str(value))
    return datetime.fromtimestamp(int(m.group(1)) / 1000, timezone.utc) if m else None


def fetch_dexcom(settings: dict) -> list[dict]:
    base = DEXCOM_BASES.get(settings.get("region") or "us", DEXCOM_BASES["us"])
    username = settings.get("username")
    password = settings.get("password")
    if not username or not password:
        raise CgmError("Identifiants Dexcom manquants")
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    try:
        r = requests.post(
            f"{base}/General/AuthenticatePublisherAccount",
            json={"accountName": username, "password": password, "applicationId": DEXCOM_APPLICATION_ID},
            headers=headers,
            timeout=20,
        )
        if r.status_code != 200:
            raise CgmError("Identifiants Dexcom invalides ou partage non activé")
        account = _quoted(r.text)

        r = requests.post(
            f"{base}/General/LoginPublisherAccountById",
            json={"accountId": account, "password": password, "applicationId": DEXCOM_APPLICATION_ID},
            headers=headers,
            timeout=20,
        )
        if r.status_code != 200 or not r.text or r.text == "null":
            raise CgmError("Connexion Dexcom impossible (vérifiez le partage Dexcom)")
        session = _quoted(r.text)

        r = requests.post(
            f"{base}/Publisher/ReadPublisherLatestGlucoseValues",
            params={"sessionId": session, "minutes": 1440, "maxCount": 288},
            json={},
            headers=headers,
            timeout=25,
        )
        if r.status_code in (401, 403) or not r.text or r.text == "null":
            raise CgmError("Session Dexcom expirée, resynchronisez")
        r.raise_for_status()
        arr = r.json() or []
    except CgmError:
        raise
    except requests.RequestException as e:
        logger.warning(f"Dexcom network error: {e}")
        raise CgmError("Dexcom injoignable, réessayez plus tard")

    readings = []
    for item in arr:
        try:
            ts = _dexcom_date(item.get("WT") or item.get("DT"))
            value = float(item.get("Value"))
        except (TypeError, ValueError):
            continue
        if ts and value > 0:
            readings.append({"ts": ts, "value": value})
    if not readings:
        raise CgmError("Aucune donnée Dexcom disponible sur les dernières 24 h")
    return readings


def _libre_parse_ts(item: dict) -> Optional[datetime]:
    """Analyse et normalise l'horodatage LibreLinkUp en UTC strict pour éviter tout décalage."""
    for key in ("FactoryTimestamp", "Timestamp"):
        val = item.get(key)
        if not val:
            continue
        val_str = str(val).strip()
        # Tentative de parsing du format standard Abbott ("M/D/YYYY h:mm:ss AM/PM")
        try:
            dt = datetime.strptime(val_str, "%m/%d/%Y %I:%M:%S %p")
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
        # Tentative de parsing ISO 8601 au cas où l'API renvoie un format normalisé
        try:
            dt = datetime.fromisoformat(val_str.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            pass
    return None


LIBRE_VERSION = os.environ.get("LIBRE_LINKUP_VERSION", "4.16.0")
LIBRE_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU OS 17_4.1 like Mac OS X) AppleWebKit/536.26 "
    "(KHTML, like Gecko) Version/17.4.1 Mobile/10A5355d Safari/8536.25"
)
LIBRE_STATUS_MESSAGES = {
    2: (
        "Abbott refuse ces identifiants (e-mail ou mot de passe). Vérifiez : 1) il s'agit bien du compte de l'application "
        "LibreLinkUp (suiveur), pas de LibreLink/LibreView ; 2) aucun espace avant/après ; 3) le mot de passe LibreLinkUp "
        "(il peut différer de celui de LibreView : réinitialisez-le dans LibreLinkUp si besoin)"
    ),
    4: "Ouvrez l'application LibreLinkUp, acceptez les nouvelles conditions d'utilisation, puis réessayez",
    429: "Trop de tentatives de connexion LibreLinkUp : patientez quelques minutes avant de réessayer",
    430: "Trop de tentatives de connexion LibreLinkUp : patientez quelques minutes avant de réessayer",
}
# Statuts applicatifs renvoyés par Abbott pour un compte non finalisé (email non vérifié, âge, etc.)
LIBRE_ACCOUNT_STEPS = {
    "tou": "Ouvrez l'application LibreLinkUp, acceptez les nouvelles conditions d'utilisation, puis réessayez",
    "pp": "Ouvrez l'application LibreLinkUp, acceptez la politique de confidentialité, puis réessayez",
    "verifyDob": "Finalisez votre compte dans l'application LibreLinkUp (date de naissance), puis réessayez",
    "verifyEmail": "Vérifiez votre adresse e-mail LibreLinkUp (lien reçu par e-mail), puis réessayez",
}


def _libre_headers(version: str) -> dict:
    return {
        "User-Agent": LIBRE_USER_AGENT,
        "Accept": "application/json",
        "Content-Type": "application/json;charset=UTF-8",
        "Cache-Control": "no-cache",
        "Connection": "Keep-Alive",
        "product": "llu.ios",
        "version": version,
    }


def _libre_json(r: requests.Response) -> dict:
    """Décode la réponse Abbott ; une page HTML (Cloudflare) n'est pas une réponse applicative."""
    ctype = (r.headers.get("Content-Type") or "").lower()
    if "json" not in ctype:
        logger.warning("LibreLinkUp non-JSON response: http=%s ctype=%s", r.status_code, ctype)
        raise CgmError("LibreLinkUp bloque temporairement les requêtes automatiques, réessayez dans quelques minutes")
    try:
        return r.json() or {}
    except ValueError:
        raise CgmError("Réponse LibreLinkUp illisible, réessayez plus tard")


def _libre_login(session: requests.Session, base: str, email: str, password: str, version: str, _depth: int = 0):
    """Login LibreLinkUp : région, CGU, version minimale, statuts d'erreur applicatifs."""
    r = session.post(
        f"{base}/llu/auth/login",
        json={"email": email, "password": password},
        headers=_libre_headers(version),
        timeout=25,
    )
    if r.status_code in (401, 403) and "json" not in (r.headers.get("Content-Type") or ""):
        logger.warning("LibreLinkUp login blocked: host=%s http=%s", base, r.status_code)
        raise CgmError("LibreLinkUp bloque temporairement les requêtes automatiques, réessayez dans quelques minutes")
    if r.status_code == 429:
        raise CgmError(LIBRE_STATUS_MESSAGES[429])
    body = _libre_json(r)
    data = body.get("data") or {}
    status = body.get("status")
    step = (data.get("step") or {}).get("type")
    logger.info(
        "LibreLinkUp login: host=%s http=%s status=%s redirect=%s region=%s step=%s ticket=%s version=%s",
        base, r.status_code, status, data.get("redirect"), data.get("region"), step,
        bool((data.get("authTicket") or {}).get("token")), version,
    )

    if status == 920:
        minimum = str(data.get("minimumVersion") or "").strip()
        if minimum and minimum != version and _depth < 2:
            logger.info("LibreLinkUp minimum version %s, retrying", minimum)
            return _libre_login(session, base, email, password, minimum, _depth + 1)
        raise CgmError("Version LibreLinkUp non acceptée par Abbott, mise à jour de l'application nécessaire")

    if status in LIBRE_STATUS_MESSAGES:
        raise CgmError(LIBRE_STATUS_MESSAGES[status])
    if r.status_code in (401, 403):
        raise CgmError(LIBRE_STATUS_MESSAGES[2])

    if data.get("redirect") and data.get("region"):
        region = str(data["region"]).lower()
        target = LIBRE_HOSTS.get(region)
        if not target:
            raise CgmError(f"Région LibreLinkUp « {region.upper()} » non prise en charge")
        if _depth >= 3:
            raise CgmError("Trop de redirections LibreLinkUp, réessayez plus tard")
        return _libre_login(session, target, email, password, version, _depth + 1)

    if step in LIBRE_ACCOUNT_STEPS:
        raise CgmError(LIBRE_ACCOUNT_STEPS[step])
    if step:
        raise CgmError(f"Votre compte LibreLinkUp demande une action dans l'application ({step}), puis réessayez")

    if status not in (0, None) or not (data.get("authTicket") or {}).get("token"):
        message = ((body.get("error") or {}).get("message") or "").strip()
        logger.warning("LibreLinkUp login failed: status=%s error=%s", status, message)
        raise CgmError("Connexion LibreLinkUp refusée" + (f" ({message})" if message else "") + ". Vérifiez vos identifiants et la région du compte")

    return base, version, data


def _libre_authenticate(session: requests.Session, settings: dict) -> tuple[str, str, dict]:
    email = settings.get("username")
    password = settings.get("password")
    if not email or not password:
        raise CgmError("Identifiants LibreLinkUp manquants")

    cache = settings.get("libre_auth") or {}
    now_ts = int(datetime.now(timezone.utc).timestamp())
    if cache.get("token") and cache.get("account_id") and int(cache.get("expires") or 0) - 300 > now_ts and not settings.get("_force_login"):
        version = cache.get("version") or LIBRE_VERSION
        headers = _libre_headers(version)
        headers["Authorization"] = f"Bearer {cache['token']}"
        headers["account-id"] = cache["account_id"]
        return cache.get("base") or LIBRE_HOSTS["global"], version, headers

    base = LIBRE_HOSTS.get(settings.get("region") or "global", LIBRE_HOSTS["global"])
    base, version, data = _libre_login(session, base, email, password, LIBRE_VERSION)
    ticket = data.get("authTicket") or {}
    uid = (data.get("user") or {}).get("id")
    if not ticket.get("token") or not uid:
        raise CgmError("Réponse LibreLinkUp inattendue")
    account_id = hashlib.sha256(str(uid).encode()).hexdigest()
    settings["_libre_auth_update"] = {
        "token": ticket["token"],
        "expires": int(ticket.get("expires") or (now_ts + 6 * 3600)),
        "account_id": account_id,
        "base": base,
        "version": version,
    }
    headers = _libre_headers(version)
    headers["Authorization"] = f"Bearer {ticket['token']}"
    headers["account-id"] = account_id
    return base, version, headers


def fetch_libre(settings: dict) -> list[dict]:
    session = requests.Session()
    try:
        base, version, auth_headers = _libre_authenticate(session, settings)

        r = session.get(f"{base}/llu/connections", headers=auth_headers, timeout=25)
        if r.status_code in (401, 403) and not settings.get("_force_login"):
            logger.info("LibreLinkUp ticket rejected (http=%s), re-login", r.status_code)
            settings["_force_login"] = True
            return fetch_libre(settings)
        body = _libre_json(r)
        if body.get("status") not in (0, None):
            raise CgmError(LIBRE_STATUS_MESSAGES.get(body.get("status"), "LibreLinkUp a refusé la requête, réessayez plus tard"))
        connections = body.get("data") or []
        if not connections:
            raise CgmError(
                "Aucun partage actif : dans l'app LibreLink (Menu > Applications connectées > LibreLinkUp), "
                "invitez ce compte LibreLinkUp, puis acceptez l'invitation dans LibreLinkUp"
            )
        wanted = settings.get("patient_id")
        connection_meta = next((c for c in connections if wanted and c.get("patientId") == wanted), connections[0])
        patient_id = connection_meta.get("patientId")
        settings["_libre_patients"] = [
            {"id": c.get("patientId"), "name": " ".join(x for x in (c.get("firstName"), c.get("lastName")) if x).strip() or "Patient"}
            for c in connections if c.get("patientId")
        ]
        settings["_libre_selected_patient"] = patient_id
        logger.info("LibreLinkUp connections=%s using patient=%s", len(connections), patient_id)

        r = session.get(f"{base}/llu/connections/{patient_id}/graph", headers=auth_headers, timeout=25)
        body = _libre_json(r)
        if body.get("status") not in (0, None):
            raise CgmError("LibreLinkUp n'a pas renvoyé les mesures, réessayez plus tard")
        connection = (body.get("data") or {}).get("connection") or {}
        graph = (body.get("data") or {}).get("graphData") or connection.get("graphData") or []
        current = connection.get("glucoseMeasurement")
        sensor = connection.get("sensor") or {}
        if not graph and not current and sensor.get("sn") is None:
            raise CgmError("Aucun capteur actif détecté sur ce compte LibreLinkUp")
    except CgmError:
        raise
    except requests.RequestException as e:
        logger.warning(f"Libre network error: {e}")
        raise CgmError("LibreLinkUp injoignable, réessayez plus tard")
    finally:
        session.close()

    readings = []
    for item in graph:
        ts = _libre_parse_ts(item)
        try:
            value = float(item.get("ValueInMgPerDl"))
        except (TypeError, ValueError):
            continue
        if ts and value > 0:
            readings.append({"ts": ts, "value": value})
    if current:
        ts = _libre_parse_ts(current)
        try:
            value = float(current.get("ValueInMgPerDl"))
        except (TypeError, ValueError):
            value = 0
        if ts and value > 0:
            readings.append({"ts": ts, "value": value})
    if not readings:
        raise CgmError("Aucune donnée Libre disponible : vérifiez que le capteur est actif et que LibreLink a bien envoyé des mesures")
    return readings


def fetch_nightscout(settings: dict) -> list[dict]:
    url = (settings.get("nightscout_url") or "").strip()
    if not url:
        raise CgmError("URL Nightscout manquante")
    params = {"count": 288}
    token = (settings.get("token") or "").strip()
    if token:
        params["token"] = token
    try:
        r = requests.get(url.rstrip("/") + "/api/v1/entries.json", params=params, timeout=20)
        r.raise_for_status()
        entries = r.json() or []
    except (requests.RequestException, ValueError):
        raise CgmError("Site Nightscout injoignable, vérifiez l'URL")

    readings = []
    for entry in entries:
        if entry.get("type") != "sgv":
            continue
        try:
            value = float(entry.get("sgv"))
            ts = datetime.fromtimestamp(int(entry.get("date")) / 1000, timezone.utc)
        except (TypeError, ValueError):
            continue
        if value > 0:
            readings.append({"ts": ts, "value": value})
    if not readings:
        raise CgmError("Aucune donnée Nightscout disponible")
    return readings


FETCHERS = {"dexcom": fetch_dexcom, "libre": fetch_libre, "nightscout": fetch_nightscout}


class CgmSettingsIn(BaseModel):
    source: str
    region: str = "us"
    username: str = ""
    password: str = ""
    nightscout_url: str = ""
    token: str = ""
    patient_id: str = ""


def register_cgm(api_router: APIRouter, db, get_current_user) -> None:
    async def _status_doc(uid: str):
        return await db.cgm_settings.find_one({"user_id": uid, "deleted_at": None})

    @api_router.get("/cgm/status")
    async def cgm_status(user: dict = Depends(get_current_user)):
        doc = await _status_doc(user["user_id"])
        if not doc:
            return {"configured": False}
        last_sync = doc.get("last_sync_at")
        return {
            "configured": True,
            "source": doc.get("source"),
            "source_label": SOURCE_LABELS.get(doc.get("source"), doc.get("source")),
            "region": doc.get("region"),
            "last_sync_at": last_sync.isoformat() if last_sync else None,
            "last_sync_inserted": doc.get("last_sync_inserted", 0),
            "last_error": doc.get("last_error"),
        }

    @api_router.post("/cgm/settings")
    async def save_cgm_settings(payload: CgmSettingsIn, user: dict = Depends(get_current_user)):
        if payload.source not in FETCHERS:
            raise HTTPException(status_code=400, detail="Source non supportée")
        uid = user["user_id"]
        now = datetime.now(timezone.utc)
        doc = await db.cgm_settings.find_one({"user_id": uid})
        update = {
            "user_id": uid,
            "source": payload.source,
            "region": payload.region,
            "username": payload.username,
            "nightscout_url": payload.nightscout_url,
            "token": payload.token,
            "patient_id": payload.patient_id,
            "deleted_at": None,
            "last_error": None,
            "libre_auth": None,
            "updated_at": now,
        }
        if payload.password:
            update["password"] = payload.password
        elif doc:
            update["password"] = doc.get("password", "")
        await db.cgm_settings.update_one(
            {"user_id": uid}, {"$set": update, "$setOnInsert": {"created_at": now}}, upsert=True
        )
        return await cgm_status(user)

    @api_router.delete("/cgm/settings")
    async def disconnect_cgm(user: dict = Depends(get_current_user)):
        await db.cgm_settings.update_one(
            {"user_id": user["user_id"]}, {"$set": {"deleted_at": datetime.now(timezone.utc)}}
        )
        return {"ok": True}

    @api_router.post("/cgm/test")
    async def test_cgm_settings(payload: CgmSettingsIn, user: dict = Depends(get_current_user)):
        """Teste des identifiants sans rien enregistrer : renvoie le verdict du fournisseur."""
        if payload.source not in FETCHERS:
            raise HTTPException(status_code=400, detail="Source CGM inconnue")
        settings = {
            "source": payload.source,
            "region": payload.region or "global",
            "username": (payload.username or "").strip(),
            "password": payload.password or "",
            "nightscout_url": (payload.nightscout_url or "").strip(),
            "token": (payload.token or "").strip(),
            "patient_id": payload.patient_id or "",
        }
        logger.info("Test CGM %s (région %s) pour %s", payload.source, settings["region"], user["user_id"])
        try:
            readings = await run_in_threadpool(FETCHERS[payload.source], settings)
        except CgmError as e:
            raise HTTPException(status_code=400, detail=str(e))
        latest = max(readings, key=lambda r: r["ts"]) if readings else None
        patients = settings.get("_libre_patients") or []
        return {
            "ok": True,
            "readings": len(readings),
            "patients": patients,
            "selected_patient": settings.get("_libre_selected_patient") or "",
            "latest_value": latest["value"] if latest else None,
            "latest_at": latest["ts"].isoformat() if latest else None,
            "message": f"Connexion réussie : {len(readings)} mesure(s) disponible(s)" + (f", dernière {round(latest['value'])} mg/dL" if latest else "")
            + (f" · {len(patients)} patients suivis : choisissez le bon ci-dessous" if len(patients) > 1 else ""),
        }

    @api_router.post("/cgm/sync")
    async def sync_cgm(user: dict = Depends(get_current_user)):
        uid = user["user_id"]
        doc = await _status_doc(uid)
        if not doc:
            raise HTTPException(status_code=400, detail="Aucun capteur configuré")
        fetcher = FETCHERS[doc["source"]]
        try:
            readings = await run_in_threadpool(fetcher, doc)
        except CgmError as e:
            await db.cgm_settings.update_one(
                {"_id": doc["_id"]},
                {"$set": {"last_error": str(e), "last_sync_at": datetime.now(timezone.utc)}},
            )
            raise HTTPException(status_code=400, detail=str(e))

        if doc.get("_libre_auth_update"):
            await db.cgm_settings.update_one({"_id": doc["_id"]}, {"$set": {"libre_auth": doc["_libre_auth_update"]}})

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=1)
        readings = [r for r in readings if r["ts"] >= cutoff]
        readings.sort(key=lambda r: r["ts"])

        external_ids = [f"{uid}:{doc['source']}:{int(r['ts'].timestamp())}" for r in readings]
        existing = await db.glucose_readings.find(
            {"user_id": uid, "external_id": {"$in": external_ids}}, {"external_id": 1}
        ).to_list(len(external_ids) or 1)
        existing_set = {e["external_id"] for e in existing}

        new_docs = []
        seen = set()
        for reading, external_id in zip(readings, external_ids):
            if external_id in existing_set or external_id in seen:
                continue
            seen.add(external_id)
            new_docs.append(
                {
                    "user_id": uid,
                    "value_mgdl": reading["value"],
                    "context": "",
                    "note": "",
                    "source": doc["source"],
                    "external_id": external_id,
                    "measured_at": reading["ts"],
                    "deleted_at": None,
                    "created_at": now,
                }
            )

        inserted = 0
        if new_docs:
            result = await db.glucose_readings.insert_many(new_docs)
            inserted = len(result.inserted_ids)
            latest_new = new_docs[-1]
            await notify_hypo_if_needed(db, uid, latest_new["value_mgdl"], latest_new["measured_at"])

        await db.cgm_settings.update_one(
            {"_id": doc["_id"]},
            {"$set": {"last_sync_at": now, "last_sync_inserted": inserted, "last_error": None}},
        )
        return {
            "inserted": inserted,
            "total": len(external_ids),
            "source": doc["source"],
            "last_value": readings[-1]["value"] if readings else None,
            "last_at": readings[-1]["ts"].isoformat() if readings else None,
        }