"""Iteration 7 tests: LibreView CSV import, hypo email alerts on share links, CGM credential test."""
import time
from datetime import datetime, timedelta, timezone

import pytest


# ----- LibreView import -----

FR_HEADERS = (
    "Glucose Data,Généré le 2026-06-15 09:00 UTC,Généré par utilisateur\n"
    "Appareil,Numéro de série,Horodatage de l'appareil,Type d'enregistrement,"
    "Historique de la glycémie mg/dL,Scan de glycémie mg/dL,"
    "Insuline à action rapide non numérique,Insuline à action rapide (unités),"
    "Aliments non numériques,Glucides (grammes),Glucides (portions),"
    "Insuline à action lente non numérique,Insuline à action lente (unités),"
    "Notes,Glycémie de la bandelette mg/dL,Cétone mmol/L,"
    "Insuline pour le repas (unités),Insuline de correction (unités),"
    "Insuline modifiée par l'utilisateur (unités)"
)


def _fr_csv():
    rows = [
        FR_HEADERS,
        # Type 0 historic reading (08:00 Paris → 06:00Z)
        "FreeStyle,SN123,15-06-2026 08:00,0,112,,,,,,,,,,,,,,",
        # Type 1 scan reading col scan (index 5)
        "FreeStyle,SN123,15-06-2026 09:00,1,,140,,,,,,,,,,,,,",
        # Type 4 rapid insulin (col 7) 5.0U
        "FreeStyle,SN123,15-06-2026 12:00,4,,,,5.0,,,,,,,,,,,",
        # Type 4 long-acting insulin (col 12) 12.0U
        "FreeStyle,SN123,15-06-2026 22:00,4,,,,,,,,,12.0,,,,,,",
        # Type 5 carbs (col 9) 50g
        "FreeStyle,SN123,15-06-2026 12:00,5,,,,,,50,,,,,,,,,",
        # Unparsable date
        "FreeStyle,SN123,not-a-date,0,120,,,,,,,,,,,,,,",
    ]
    return rows


class TestLibreImport:
    def test_fr_import_and_dedup(self, api_alice, mongo_db):
        mongo_db.glucose_readings.delete_many({"user_id": "user_testalice", "source": "libre"})
        mongo_db.insulin_doses.delete_many({"user_id": "user_testalice", "note": "Import LibreView"})
        mongo_db.meals.delete_many({"user_id": "user_testalice", "name": "Repas (import LibreView)"})

        payload = {"lines": _fr_csv(), "tz": "Europe/Paris", "batch_index": 0}
        r = api_alice.post(f"{BASE_URL}/api/import/libreview", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["readings_parsed"] == 2
        assert data["readings_inserted"] == 2
        assert data["insulin_inserted"] == 2
        assert data["meals_inserted"] == 1
        assert data["skipped"] == 1

        # Verify persistence + timezone conversion (08:00 Paris → 06:00Z in June DST)
        g = api_alice.get(f"{BASE_URL}/api/glucose").json()
        libre = [x for x in g if x.get("source") == "libre"]
        assert any(x["value_mgdl"] == 112 and x["measured_at"].startswith("2026-06-15T06:00") for x in libre), libre
        assert all(x.get("note") == "Import LibreView" for x in libre)

        # Insulin kinds
        ins = api_alice.get(f"{BASE_URL}/api/insulin").json()
        recent = [x for x in ins if x.get("note") == "Import LibreView"]
        kinds = {x["kind"] for x in recent}
        assert kinds == {"bolus", "basale"}, kinds

        # Meal carbs
        meals = api_alice.get(f"{BASE_URL}/api/meals").json()
        m = [x for x in meals if x.get("name") == "Repas (import LibreView)"]
        assert m and any(round(x["carbs_g"]) == 50 for x in m)

        # Replay → dedup
        r2 = api_alice.post(f"{BASE_URL}/api/import/libreview", json=payload)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["readings_inserted"] == 0
        assert d2["insulin_inserted"] == 0
        assert d2["meals_inserted"] == 0

    def test_english_variant_am(self, api_alice, mongo_db):
        mongo_db.glucose_readings.delete_many({"user_id": "user_testalice", "source": "libre"})
        headers = (
            "Glucose Data,Generated on 2026-06-15\n"
            "Device,Serial Number,Device Timestamp,Record Type,"
            "Historic Glucose mg/dL,Scan Glucose mg/dL,"
            "Non-numeric Rapid-Acting Insulin,Rapid-Acting Insulin (units),"
            "Non-numeric Food,Carbohydrates (grams),Carbohydrates (servings),"
            "Non-numeric Long-Acting Insulin,Long-Acting Insulin (units),"
            "Notes,Strip Glucose mg/dL,Ketone mmol/L,Meal Insulin (units),"
            "Correction Insulin (units),User Change Insulin (units)"
        )
        lines = [headers, "FreeStyle,SN,06-15-2026 08:00 AM,0,118,,,,,,,,,,,,,,"]
        r = api_alice.post(f"{BASE_URL}/api/import/libreview", json={"lines": lines, "tz": "Europe/Paris"})
        assert r.status_code == 200, r.text
        assert r.json()["readings_inserted"] == 1

    def test_mmol_variant(self, api_alice, mongo_db):
        mongo_db.glucose_readings.delete_many({"user_id": "user_testalice", "source": "libre"})
        headers = (
            "Glucose Data\n"
            "Device,SN,Device Timestamp,Record Type,Historic Glucose mmol/L,Scan Glucose mmol/L,"
            "Non-numeric,Rapid (units),Non-numeric,Carbohydrates (grams),Portions,"
            "Non-numeric,Long (units),Notes,Strip mmol/L,Ketone,Meal,Correction,User"
        )
        lines = [headers, "FreeStyle,SN,15-06-2026 09:30,0,6.2,,,,,,,,,,,,,,"]
        r = api_alice.post(f"{BASE_URL}/api/import/libreview", json={"lines": lines, "tz": "Europe/Paris"})
        assert r.status_code == 200
        assert r.json()["readings_inserted"] == 1
        g = api_alice.get(f"{BASE_URL}/api/glucose").json()
        libre = [x for x in g if x.get("source") == "libre" and x["measured_at"].startswith("2026-06-15T07:30")]
        assert libre, "expected 2026-06-15T07:30Z reading"
        assert 110 <= libre[0]["value_mgdl"] <= 114, libre[0]  # 6.2 * 18.016 ≈ 111.7 → 112

    def test_missing_header_400(self, api_alice):
        r = api_alice.post(f"{BASE_URL}/api/import/libreview", json={"lines": ["a,b,c", "1,2,3"], "tz": "Europe/Paris"})
        assert r.status_code == 400

    def test_too_many_lines_400(self, api_alice):
        big = ["a"] * 6001
        r = api_alice.post(f"{BASE_URL}/api/import/libreview", json={"lines": big, "tz": "Europe/Paris"})
        assert r.status_code == 400

    def test_no_auth_401(self, api_anon):
        r = api_anon.post(f"{BASE_URL}/api/import/libreview", json={"lines": ["x"], "tz": "Europe/Paris"})
        assert r.status_code == 401


# ----- Share hypo email alerts -----

class TestShareHypoAlerts:
    def test_share_alert_email_lifecycle(self, api_alice, mongo_db):
        # Set target_low to 80 so 58 triggers alert
        api_alice.put(f"{BASE_URL}/api/profile", json={"target_low": 80, "target_high": 180})

        # Clear share links for alice
        mongo_db.share_links.delete_many({"user_id": "user_testalice"})

        # Invalid email → 400
        r = api_alice.post(f"{BASE_URL}/api/share", json={"label": "Papa", "alert_email": "bad-email"})
        assert r.status_code == 400

        # Create share with valid alert_email
        r = api_alice.post(f"{BASE_URL}/api/share", json={"label": "Papa", "alert_email": "delivered@resend.dev"})
        assert r.status_code == 200, r.text
        share = r.json()
        share_id = share["id"]
        assert share["alert_email"] == "delivered@resend.dev"

        # POST hypo → should trigger 1 email
        r = api_alice.post(f"{BASE_URL}/api/glucose", json={"value_mgdl": 58})
        assert r.status_code == 200
        # give backend a moment to send email + update
        time.sleep(3)

        listing = api_alice.get(f"{BASE_URL}/api/share").json()
        row = next(x for x in listing if x["id"] == share_id)
        assert row.get("alerts_sent") == 1, f"expected 1 alert sent, got: {row}"

        # 2nd hypo within cooldown → still 1
        api_alice.post(f"{BASE_URL}/api/glucose", json={"value_mgdl": 55})
        time.sleep(2)
        listing = api_alice.get(f"{BASE_URL}/api/share").json()
        row = next(x for x in listing if x["id"] == share_id)
        assert row.get("alerts_sent") == 1, f"cooldown broken: {row}"

        # Normal reading → no additional alert
        api_alice.post(f"{BASE_URL}/api/glucose", json={"value_mgdl": 120})
        time.sleep(1)
        listing = api_alice.get(f"{BASE_URL}/api/share").json()
        row = next(x for x in listing if x["id"] == share_id)
        assert row.get("alerts_sent") == 1

        # Old measurement (5h ago) → no alert (still 1) — reset cooldown first
        mongo_db.share_links.update_one({"_id": _oid(share_id)}, {"$set": {"last_alert_at": None}})
        old = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
        api_alice.post(f"{BASE_URL}/api/glucose", json={"value_mgdl": 58, "measured_at": old})
        time.sleep(1)
        listing = api_alice.get(f"{BASE_URL}/api/share").json()
        row = next(x for x in listing if x["id"] == share_id)
        assert row.get("alerts_sent") == 1

        # PATCH to disable
        r = api_alice.patch(f"{BASE_URL}/api/share/{share_id}", json={"alert_email": ""})
        assert r.status_code == 200
        assert r.json().get("alert_email") == ""

        # Cleanup: revoke share, remove hypo readings
        api_alice.delete(f"{BASE_URL}/api/share/{share_id}")
        mongo_db.glucose_readings.delete_many({"user_id": "user_testalice", "value_mgdl": {"$lt": 70}})

    def test_patch_share_of_other_user_404(self, api_alice, api_bob, mongo_db):
        mongo_db.share_links.delete_many({"user_id": "user_testalice"})
        r = api_alice.post(f"{BASE_URL}/api/share", json={"label": "X"})
        sid = r.json()["id"]
        r = api_bob.patch(f"{BASE_URL}/api/share/{sid}", json={"alert_email": "x@y.fr"})
        assert r.status_code == 404
        # cleanup
        api_alice.delete(f"{BASE_URL}/api/share/{sid}")


# ----- CGM test endpoint -----

class TestCgmTest:
    def test_no_auth_401(self, api_anon):
        r = api_anon.post(f"{BASE_URL}/api/cgm/test", json={"source": "libre", "region": "fr", "username": "x@y.fr", "password": "bad"})
        assert r.status_code == 401

    def test_libre_bad_creds_400(self, api_alice):
        status_before = api_alice.get(f"{BASE_URL}/api/cgm/status").json()
        r = api_alice.post(
            f"{BASE_URL}/api/cgm/test",
            json={"source": "libre", "region": "fr", "username": "invalid@example.com", "password": "definitelyWrongPw!"},
        )
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "")
        assert detail.startswith("Abbott refuse ces identifiants"), detail
        # Ensure nothing was saved
        status_after = api_alice.get(f"{BASE_URL}/api/cgm/status").json()
        assert status_after == status_before


# ----- helpers -----
import os
import sys
from bson import ObjectId
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from conftest import BASE_URL  # noqa


def _oid(x):
    return ObjectId(x)
