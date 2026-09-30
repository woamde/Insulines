"""Iteration 9 backend tests: AI models list + coach IA multi-modèles + CGM libre patients schema.

- GET /api/ai/models must include gpt-5.4 and gpt-5.4-mini (OpenAI provider).
- GET /api/ai/coach with valid Bearer + glucose readings → single real LLM call, insert in ai_coach_reports.
- GET /api/ai/coach with no readings → 400.
- GET /api/ai/coach without Bearer → 401.
- Code inspection: /api/cgm/test response includes patients[] and selected_patient.
"""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

DEVTEST_TOKEN = "devtest_token_123"
DEVTEST_UID = "user_devtest"

# secondary user with no readings, to trigger the 400 path
UID_NO_GLUC = "user_iter9_nogluc"
TOK_NO_GLUC = "tok_iter9_nogluc"


@pytest.fixture(scope="module")
def mongo_sync():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


@pytest.fixture(scope="module", autouse=True)
def seed_no_gluc_user(mongo_sync):
    now = datetime.now(timezone.utc)
    mongo_sync.users.delete_many({"user_id": UID_NO_GLUC})
    mongo_sync.user_sessions.delete_many({"session_token": TOK_NO_GLUC})
    mongo_sync.glucose_readings.delete_many({"user_id": UID_NO_GLUC})
    mongo_sync.users.insert_one({
        "user_id": UID_NO_GLUC, "email": "iter9_nogluc@test.local",
        "name": "IterNoGluc", "picture": "", "created_at": now,
    })
    mongo_sync.user_sessions.insert_one({
        "session_token": TOK_NO_GLUC, "user_id": UID_NO_GLUC,
        "created_at": now, "expires_at": now + timedelta(days=7),
    })
    yield
    mongo_sync.users.delete_many({"user_id": UID_NO_GLUC})
    mongo_sync.user_sessions.delete_many({"session_token": TOK_NO_GLUC})


# ---------------------------------------------------------------------------
# AI MODELS
# ---------------------------------------------------------------------------
def test_ai_models_requires_auth():
    r = requests.get(f"{BASE_URL}/api/ai/models", timeout=15)
    assert r.status_code == 401


def test_ai_models_lists_openai_and_others():
    r = requests.get(
        f"{BASE_URL}/api/ai/models",
        headers={"Authorization": f"Bearer {DEVTEST_TOKEN}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "default" in body and "models" in body
    keys = {m["key"] for m in body["models"]}
    # Must include the 2 new OpenAI ones
    assert "gpt-5.4" in keys, f"gpt-5.4 missing, got {keys}"
    assert "gpt-5.4-mini" in keys, f"gpt-5.4-mini missing, got {keys}"
    # Still contains Claude + Gemini
    assert any(k.startswith("claude-") for k in keys)
    assert any(k.startswith("gemini-") for k in keys)
    # Providers correctly labelled
    by_key = {m["key"]: m for m in body["models"]}
    assert by_key["gpt-5.4"]["provider"] == "OpenAI"
    assert by_key["gpt-5.4-mini"]["provider"] == "OpenAI"


# ---------------------------------------------------------------------------
# AI COACH
# ---------------------------------------------------------------------------
def test_ai_coach_requires_auth():
    r = requests.get(f"{BASE_URL}/api/ai/coach?days=14", timeout=15)
    assert r.status_code == 401


def test_ai_coach_400_when_no_readings():
    r = requests.get(
        f"{BASE_URL}/api/ai/coach?days=14&model=gpt-5.4-mini",
        headers={"Authorization": f"Bearer {TOK_NO_GLUC}"},
        timeout=30,
    )
    assert r.status_code == 400, r.text
    detail = r.json().get("detail", "")
    assert "glyc" in detail.lower() or "glycémies" in detail


def test_ai_coach_runs_once_with_gpt54mini(mongo_sync):
    """Single real LLM call with model=gpt-5.4-mini on devtest user (has readings)."""
    # Count readings first — ensure devtest actually has data
    readings_count = mongo_sync.glucose_readings.count_documents({
        "user_id": DEVTEST_UID, "deleted_at": None,
    })
    if readings_count < 5:
        pytest.skip(f"devtest user only has {readings_count} readings, need ≥5")

    before = mongo_sync.ai_coach_reports.count_documents({"user_id": DEVTEST_UID})
    r = requests.get(
        f"{BASE_URL}/api/ai/coach?days=14&model=gpt-5.4-mini",
        headers={"Authorization": f"Bearer {DEVTEST_TOKEN}"},
        timeout=120,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Structure
    assert body["days"] == 14
    assert body["model"] == "gpt-5.4-mini"
    assert body.get("model_label")
    assert body.get("created_at")
    report = body["report"]
    assert isinstance(report, dict)
    assert isinstance(report.get("overview"), str) and report["overview"].strip(), "overview must be non-empty"
    for k in ("insulin", "food", "activity", "patterns", "doctor_questions"):
        assert isinstance(report.get(k), list), f"{k} must be a list"
    assert "alert" in report and isinstance(report["alert"], str)

    # One and only one new doc inserted
    after = mongo_sync.ai_coach_reports.count_documents({"user_id": DEVTEST_UID})
    assert after == before + 1, f"expected 1 new ai_coach_reports doc, got {after - before}"


# ---------------------------------------------------------------------------
# CGM /test schema check (no real Abbott call — just verify error shape)
# ---------------------------------------------------------------------------
def test_cgm_test_libre_fake_credentials_returns_400():
    payload = {
        "source": "libre",
        "region": "global",
        "username": "notarealuser+iter9@example.invalid",
        "password": "definitely-wrong-password",
    }
    r = requests.post(
        f"{BASE_URL}/api/cgm/test",
        headers={"Authorization": f"Bearer {DEVTEST_TOKEN}"},
        json=payload,
        timeout=60,
    )
    # Expected: 400 with a clear message from Abbott (no crash)
    assert r.status_code == 400, r.text
    body = r.json()
    assert isinstance(body.get("detail"), str) and body["detail"], "detail must be non-empty"


def test_cgm_code_has_patients_and_selected_patient_in_success_schema():
    """Read cgm.py and ensure the success response of /api/cgm/test exposes patients[] and selected_patient."""
    src = (Path(__file__).resolve().parents[1] / "cgm.py").read_text(encoding="utf-8")
    assert '"patients": patients' in src, "success schema must include patients[]"
    assert '"selected_patient"' in src, "success schema must include selected_patient"
    # And the fetch_libre must populate _libre_patients / _libre_selected_patient
    assert "_libre_patients" in src
    assert "_libre_selected_patient" in src
