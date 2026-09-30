"""Itération 5 : unités glucose, activité physique, partage proche."""
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

from conftest import BASE_URL, TOKEN_ALICE, UID_ALICE, TOKEN_BOB, UID_BOB


API = f"{BASE_URL}/api"


# ---------- Section 1 : PUT /api/profile glucose_unit --------------------

def test_profile_glucose_unit_mmol_ok_and_persist(api_alice):
    r = api_alice.put(f"{API}/profile", json={"glucose_unit": "mmol"})
    assert r.status_code == 200, r.text
    assert r.json()["glucose_unit"] == "mmol"
    r2 = api_alice.get(f"{API}/profile")
    assert r2.status_code == 200
    assert r2.json()["glucose_unit"] == "mmol"
    # Reset back to mgdl
    api_alice.put(f"{API}/profile", json={"glucose_unit": "mgdl"})


def test_profile_glucose_unit_invalid_400(api_alice):
    r = api_alice.put(f"{API}/profile", json={"glucose_unit": "xx"})
    assert r.status_code == 400
    assert "Unité" in r.json().get("detail", "") or "invalide" in r.json().get("detail", "").lower()


# ---------- Section 2 : Activité physique -------------------------------

def _iso(dt: datetime) -> str:
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt.tzinfo is None else dt.isoformat()


@pytest.fixture
def clean_activities_alice(mongo_db):
    mongo_db.activities.delete_many({"user_id": UID_ALICE})
    mongo_db.glucose_readings.delete_many({"user_id": UID_ALICE})
    yield
    mongo_db.activities.delete_many({"user_id": UID_ALICE})
    mongo_db.glucose_readings.delete_many({"user_id": UID_ALICE})


def test_activity_create_and_validations(api_alice, clean_activities_alice):
    started = datetime.now(timezone.utc) - timedelta(hours=3)
    r = api_alice.post(f"{API}/activity", json={
        "activity_type": "course", "duration_min": 40, "intensity": "intense",
        "note": "x", "started_at": _iso(started)
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["activity_type"] == "course"
    assert body["duration_min"] == 40
    assert body["intensity"] == "intense"

    # invalid type
    r = api_alice.post(f"{API}/activity", json={"activity_type": "bad", "duration_min": 30, "intensity": "moderee"})
    assert r.status_code == 400
    # invalid intensity
    r = api_alice.post(f"{API}/activity", json={"activity_type": "course", "duration_min": 30, "intensity": "bad"})
    assert r.status_code == 400
    # duration too small
    r = api_alice.post(f"{API}/activity", json={"activity_type": "course", "duration_min": 3, "intensity": "moderee"})
    assert r.status_code == 400
    # duration too large
    r = api_alice.post(f"{API}/activity", json={"activity_type": "course", "duration_min": 700, "intensity": "moderee"})
    assert r.status_code == 400


def test_activity_effect_and_hypo(api_alice, clean_activities_alice):
    now = datetime.now(timezone.utc)
    started = now - timedelta(hours=3)
    duration = 40
    end = started + timedelta(minutes=duration)

    # glycémie 150 datée 1 h avant l'activité
    api_alice.post(f"{API}/glucose", json={"value_mgdl": 150, "measured_at": _iso(started - timedelta(hours=1))})
    # glycémie 95 datée 1 h après la fin
    api_alice.post(f"{API}/glucose", json={"value_mgdl": 95, "measured_at": _iso(end + timedelta(hours=1))})

    r = api_alice.post(f"{API}/activity", json={
        "activity_type": "course", "duration_min": duration, "intensity": "intense",
        "note": "x", "started_at": _iso(started)
    })
    assert r.status_code == 200
    aid = r.json()["id"]

    r = api_alice.get(f"{API}/activity")
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    top = next(i for i in items if i["id"] == aid)
    eff = top["effect"]
    assert eff["before_avg"] == 150
    assert eff["after_avg"] == 95
    assert eff["delta"] == -55
    assert eff["hypo_after"] is False

    # Ajouter une glycémie 65 après pour déclencher hypo_after
    api_alice.post(f"{API}/glucose", json={"value_mgdl": 65, "measured_at": _iso(end + timedelta(minutes=90))})
    r = api_alice.get(f"{API}/activity")
    top = next(i for i in r.json() if i["id"] == aid)
    assert top["effect"]["hypo_after"] is True

    # Suppression
    r = api_alice.delete(f"{API}/activity/{aid}")
    assert r.status_code == 200
    r = api_alice.get(f"{API}/activity")
    assert all(i["id"] != aid for i in r.json())


def test_activity_user_isolation(api_alice, api_bob, mongo_db):
    mongo_db.activities.delete_many({"user_id": {"$in": [UID_ALICE, UID_BOB]}})
    r = api_alice.post(f"{API}/activity", json={
        "activity_type": "marche", "duration_min": 15, "intensity": "legere"
    })
    assert r.status_code == 200
    alice_id = r.json()["id"]
    # Bob ne voit rien
    r_bob = api_bob.get(f"{API}/activity")
    assert all(i["id"] != alice_id for i in r_bob.json())
    # Bob ne peut pas supprimer
    r_bob_del = api_bob.delete(f"{API}/activity/{alice_id}")
    assert r_bob_del.status_code == 200  # renvoie ok mais ne supprime pas
    # Vérifier que Alice l'a toujours
    r = api_alice.get(f"{API}/activity")
    assert any(i["id"] == alice_id for i in r.json())
    api_alice.delete(f"{API}/activity/{alice_id}")


# ---------- Section 3 : /api/stats activity_* ---------------------------

def test_stats_include_activity(api_alice, mongo_db):
    mongo_db.activities.delete_many({"user_id": UID_ALICE})
    api_alice.post(f"{API}/activity", json={"activity_type": "marche", "duration_min": 20, "intensity": "legere"})
    api_alice.post(f"{API}/activity", json={"activity_type": "velo", "duration_min": 45, "intensity": "moderee"})
    r = api_alice.get(f"{API}/stats?days=7")
    assert r.status_code == 200
    body = r.json()
    assert body["activity_count"] >= 2
    assert body["activity_minutes"] >= 65
    mongo_db.activities.delete_many({"user_id": UID_ALICE})


def test_report_pdf_contains_activity(api_alice, mongo_db):
    mongo_db.activities.delete_many({"user_id": UID_ALICE})
    api_alice.post(f"{API}/activity", json={"activity_type": "marche", "duration_min": 30, "intensity": "moderee"})
    r = api_alice.get(f"{API}/report/pdf?days=30")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/pdf")
    assert r.content[:4] == b"%PDF"
    # Try text extraction
    try:
        import io
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(r.content))
        text = "\n".join(p.extract_text() or "" for p in reader.pages)
        assert "Activité" in text or "activité" in text
    except ImportError:
        pass
    mongo_db.activities.delete_many({"user_id": UID_ALICE})


# ---------- Section 4 : Partage proche ----------------------------------

@pytest.fixture
def clean_shares(mongo_db):
    mongo_db.share_links.delete_many({"user_id": {"$in": [UID_ALICE, UID_BOB]}})
    yield
    mongo_db.share_links.delete_many({"user_id": {"$in": [UID_ALICE, UID_BOB]}})


def test_share_create_label_and_defaults(api_alice, clean_shares):
    r = api_alice.post(f"{API}/share", json={"label": "Maman"})
    assert r.status_code == 200
    body = r.json()
    assert "id" in body and "token" in body
    assert len(body["token"]) >= 20
    assert body["label"] == "Maman"
    assert body["views"] == 0

    # Label vide → 'Proche'
    r2 = api_alice.post(f"{API}/share", json={"label": ""})
    assert r2.status_code == 200
    assert r2.json()["label"] == "Proche"

    # List
    r3 = api_alice.get(f"{API}/share")
    assert r3.status_code == 200
    assert len(r3.json()) >= 2


def test_share_max_5_active_but_spec_says_6th_400(api_alice, clean_shares):
    """Spec dit 6e lien actif → 400. Backend actuel autorise max 5."""
    for i in range(5):
        r = api_alice.post(f"{API}/share", json={"label": f"P{i}"})
        assert r.status_code == 200, f"i={i}: {r.text}"
    r = api_alice.post(f"{API}/share", json={"label": "P6"})
    assert r.status_code == 400


def test_shared_public_view_no_auth(api_alice, api_anon, mongo_db, clean_shares):
    # Prepare data
    mongo_db.glucose_readings.delete_many({"user_id": UID_ALICE})
    now = datetime.now(timezone.utc)
    api_alice.post(f"{API}/glucose", json={"value_mgdl": 120, "measured_at": _iso(now - timedelta(hours=5))})
    api_alice.post(f"{API}/glucose", json={"value_mgdl": 135, "measured_at": _iso(now - timedelta(minutes=10))})

    r = api_alice.post(f"{API}/share", json={"label": "Maman"})
    assert r.status_code == 200
    token = r.json()["token"]
    share_id = r.json()["id"]

    # Public GET, no Authorization
    r2 = api_anon.get(f"{API}/shared/{token}")
    assert r2.status_code == 200, r2.text
    body = r2.json()
    for k in ("owner_name", "label", "unit", "target_low", "target_high", "latest", "summary_24h", "series", "generated_at"):
        assert k in body, f"missing key {k}"
    assert body["latest"] is not None
    assert body["latest"]["value_mgdl"] == 135
    assert body["latest"]["delta"] == 15
    s = body["summary_24h"]
    for k in ("readings_count", "avg", "tir_in", "hypo_count", "carbs_g", "bolus_units", "basal_units"):
        assert k in s, f"missing summary key {k}"

    # views incrémenté et last_viewed_at rempli
    r3 = api_alice.get(f"{API}/share")
    link = next(l for l in r3.json() if l["id"] == share_id)
    assert link["views"] >= 1
    assert link["last_viewed_at"] is not None

    # Token inconnu (>=20) → 404
    r4 = api_anon.get(f"{API}/shared/" + "x" * 30)
    assert r4.status_code == 404
    # Token court → 404
    r5 = api_anon.get(f"{API}/shared/abc")
    assert r5.status_code == 404

    mongo_db.glucose_readings.delete_many({"user_id": UID_ALICE})


def test_share_revoke_and_isolation(api_alice, api_bob, api_anon, clean_shares):
    r = api_alice.post(f"{API}/share", json={"label": "Papa"})
    token = r.json()["token"]
    share_id = r.json()["id"]

    # Bob ne peut pas révoquer le lien d'Alice
    r_bob = api_bob.delete(f"{API}/share/{share_id}")
    # renvoie 200 mais ne modifie pas
    r_check = api_anon.get(f"{API}/shared/{token}")
    assert r_check.status_code == 200, "Bob ne devrait pas pouvoir révoquer le lien d'Alice"

    # Alice révoque
    r_del = api_alice.delete(f"{API}/share/{share_id}")
    assert r_del.status_code == 200
    r_final = api_anon.get(f"{API}/shared/{token}")
    assert r_final.status_code == 404


# ---------- Cleanup final : restore devtest profile ----------------------

def test_zzz_restore_devtest_profile():
    s = requests.Session()
    s.headers.update({"Authorization": "Bearer devtest_token_123", "Content-Type": "application/json"})
    r = s.put(f"{API}/profile", json={
        "glucose_unit": "mgdl", "target_low": 80, "target_high": 160, "tir_goal": 75
    })
    assert r.status_code == 200
    assert r.json()["glucose_unit"] == "mgdl"
    assert r.json()["target_low"] == 80
    assert r.json()["target_high"] == 160
