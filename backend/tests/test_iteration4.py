"""Iteration 4 tests: Objectifs personnels + envoi PDF au diabétologue."""
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

from conftest import BASE_URL, TOKEN_ALICE, TOKEN_BOB, UID_ALICE, UID_BOB, MONGO_URL, DB_NAME


API = f"{BASE_URL}/api"


# -----------------------------------------------------------------------------
# Profile targets & doctor
# -----------------------------------------------------------------------------
class TestProfileTargets:
    def test_put_profile_targets_and_doctor(self, api_alice):
        payload = {
            "target_low": 80,
            "target_high": 160,
            "tir_goal": 75,
            "doctor_name": "Dr Martin",
            "doctor_email": "Delivered@resend.dev",  # uppercase to test normalization
        }
        r = api_alice.put(f"{API}/profile", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["target_low"] == 80
        assert body["target_high"] == 160
        assert body["tir_goal"] == 75
        assert body["doctor_name"] == "Dr Martin"
        assert body["doctor_email"] == "delivered@resend.dev"  # lowercased

        # GET should return same values
        r = api_alice.get(f"{API}/profile")
        assert r.status_code == 200
        body = r.json()
        assert body["target_low"] == 80
        assert body["target_high"] == 160
        assert body["tir_goal"] == 75
        assert body["doctor_email"] == "delivered@resend.dev"

    def test_reject_invalid_range(self, api_alice):
        r = api_alice.put(f"{API}/profile", json={"target_low": 200, "target_high": 160})
        assert r.status_code == 400
        assert "Plage cible" in r.json().get("detail", "")

    def test_reject_invalid_tir_goal(self, api_alice):
        r = api_alice.put(f"{API}/profile", json={"tir_goal": 0})
        assert r.status_code == 400
        assert "cible" in r.json().get("detail", "").lower()

    def test_reject_invalid_doctor_email(self, api_alice):
        r = api_alice.put(f"{API}/profile", json={"doctor_email": "pasunemail"})
        assert r.status_code == 400
        assert "mail" in r.json().get("detail", "").lower()

    def test_partial_update_does_not_reset_targets(self, api_alice):
        # Set targets first
        api_alice.put(f"{API}/profile", json={"target_low": 80, "target_high": 160, "tir_goal": 75})
        # Partial update with only name
        r = api_alice.put(f"{API}/profile", json={"name": "Alice Renamed"})
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == "Alice Renamed"
        assert body["target_low"] == 80
        assert body["target_high"] == 160
        assert body["tir_goal"] == 75


# -----------------------------------------------------------------------------
# Stats with personal targets
# -----------------------------------------------------------------------------
class TestStatsWithPersonalTargets:
    def test_stats_uses_personal_targets(self, api_alice, mongo_db):
        # Set targets 80-160, tir_goal 75
        api_alice.put(f"{API}/profile", json={"target_low": 80, "target_high": 160, "tir_goal": 75})
        # Clean glucose_readings for alice
        mongo_db.glucose_readings.delete_many({"user_id": UID_ALICE})
        # Insert 4 readings: 75 (hypo), 120 (in), 170 (hyper), 200 (hyper)
        now = datetime.now(timezone.utc)
        for v in [75, 120, 170, 200]:
            api_alice.post(f"{API}/glucose", json={"value_mgdl": v})
        r = api_alice.get(f"{API}/stats?days=7")
        assert r.status_code == 200
        data = r.json()
        assert data["target_low"] == 80
        assert data["target_high"] == 160
        assert data["tir_goal"] == 75
        assert data["hypo_count"] == 1  # 75
        assert data["hyper_count"] == 2  # 170, 200
        assert data["readings_count"] == 4


# -----------------------------------------------------------------------------
# PDF report
# -----------------------------------------------------------------------------
class TestReportPDF:
    def test_pdf_contains_target_labels(self, api_alice):
        import io
        import pypdf

        api_alice.put(f"{API}/profile", json={"target_low": 80, "target_high": 160, "tir_goal": 75})
        r = api_alice.get(f"{API}/report/pdf?days=30")
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/pdf"
        content = r.content
        assert content[:4] == b"%PDF"
        reader = pypdf.PdfReader(io.BytesIO(content))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        assert "Plage cible" in text, f"PDF must mention 'Plage cible'. Got: {text[:800]}"
        assert "Sous la cible" in text, "PDF must mention 'Sous la cible'"
        assert "< 80" in text, "PDF must mention '< 80' threshold"


# -----------------------------------------------------------------------------
# Email report
# -----------------------------------------------------------------------------
class TestReportEmail:
    def test_unauth_returns_401(self, api_anon):
        r = api_anon.post(f"{API}/report/email?days=90&tz=Europe/Paris")
        assert r.status_code == 401

    def test_missing_doctor_email_returns_400(self, api_bob, mongo_db):
        # ensure bob has no doctor_email
        mongo_db.profiles.update_one(
            {"user_id": UID_BOB},
            {"$set": {"doctor_email": ""}},
            upsert=False,
        )
        # ensure profile exists
        api_bob.get(f"{API}/profile")
        mongo_db.profiles.update_one({"user_id": UID_BOB}, {"$set": {"doctor_email": ""}})
        r = api_bob.post(f"{API}/report/email?days=90&tz=Europe/Paris")
        assert r.status_code == 400
        assert "e-mail" in r.json().get("detail", "").lower() or "mail" in r.json().get("detail", "").lower()

    def test_daily_limit_returns_429(self, mongo_db):
        # Simulate 5 sends within 24h for a dedicated user (Bob) then attempt
        uid = UID_BOB
        # Ensure bob has doctor_email set
        mongo_db.profiles.update_one(
            {"user_id": uid},
            {"$set": {"doctor_email": "delivered@resend.dev", "doctor_name": "Dr Bob"}},
            upsert=True,
        )
        mongo_db.report_emails.delete_many({"user_id": uid})
        now = datetime.now(timezone.utc)
        mongo_db.report_emails.insert_many([
            {"user_id": uid, "to": "delivered@resend.dev", "days": 30, "email_id": f"fake{i}", "sent_at": now - timedelta(hours=i)}
            for i in range(5)
        ])
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {TOKEN_BOB}", "Content-Type": "application/json"})
        r = s.post(f"{API}/report/email?days=90&tz=Europe/Paris")
        assert r.status_code == 429, r.text
        detail = r.json().get("detail", "")
        assert "5" in detail or "imite" in detail
        # cleanup
        mongo_db.report_emails.delete_many({"user_id": uid})

    def test_send_report_email_success(self, api_alice, mongo_db):
        # Ensure alice has valid doctor email and no prior sends
        api_alice.put(
            f"{API}/profile",
            json={
                "target_low": 80,
                "target_high": 160,
                "tir_goal": 75,
                "doctor_name": "Dr Martin",
                "doctor_email": "delivered@resend.dev",
            },
        )
        mongo_db.report_emails.delete_many({"user_id": UID_ALICE})
        r = api_alice.post(f"{API}/report/email?days=90&tz=Europe/Paris")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["to"] == "delivered@resend.dev"
        assert body["days"] == 90
        # Verify persistence
        rec = mongo_db.report_emails.find_one({"user_id": UID_ALICE})
        assert rec is not None
        assert rec["to"] == "delivered@resend.dev"
