"""Backend tests: auth, scoping, AI, CGM regression."""
import base64
import io
import time

import pytest
from PIL import Image, ImageDraw

from conftest import BASE_URL, UID_ALICE, UID_BOB


def _make_food_image_b64() -> str:
    """Produce a realistic-ish JPEG with visual features (not solid color)."""
    img = Image.new("RGB", (256, 256), (250, 240, 200))
    d = ImageDraw.Draw(img)
    # plate
    d.ellipse((20, 20, 236, 236), fill=(255, 255, 255), outline=(160, 160, 160), width=3)
    # bread
    d.rectangle((60, 80, 200, 150), fill=(200, 150, 80), outline=(120, 80, 40), width=2)
    d.line((70, 100, 190, 100), fill=(140, 90, 40), width=2)
    d.line((70, 120, 190, 120), fill=(140, 90, 40), width=2)
    # pasta noodles
    for i in range(0, 12):
        d.arc((60 + i * 6, 155, 200 - i * 4, 210 - i * 2), 0, 180, fill=(240, 210, 120), width=3)
    # tomato slices
    d.ellipse((140, 60, 180, 100), fill=(220, 60, 60), outline=(140, 40, 40), width=2)
    d.ellipse((80, 60, 120, 100), fill=(220, 60, 60), outline=(140, 40, 40), width=2)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ---------------------------------------------------------------------------
# AUTH / gating
# ---------------------------------------------------------------------------
class TestAuthGating:
    def test_root_public(self, api_anon):
        r = api_anon.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    @pytest.mark.parametrize("path", [
        "/api/profile", "/api/glucose", "/api/meals", "/api/foods",
        "/api/stats", "/api/cgm/status", "/api/ai/messages",
        "/api/ai/models", "/api/ai/weekly-summary", "/api/auth/me",
    ])
    def test_get_requires_auth(self, api_anon, path):
        r = api_anon.get(f"{BASE_URL}{path}")
        assert r.status_code == 401, f"{path} returned {r.status_code}"

    @pytest.mark.parametrize("path,payload", [
        ("/api/ai/chat", {"message": "salut", "model": "claude-sonnet-4-6"}),
        ("/api/ai/analyze-meal", {"image_base64": "AAA"}),
        ("/api/glucose", {"value_mgdl": 120}),
        ("/api/meals", {"carbs_g": 40}),
    ])
    def test_post_requires_auth(self, api_anon, path, payload):
        r = api_anon.post(f"{BASE_URL}{path}", json=payload)
        assert r.status_code == 401

    def test_session_with_fake_id(self, api_anon):
        r = api_anon.post(f"{BASE_URL}/api/auth/session", json={"session_id": "fake_bogus_sid"})
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# SCOPING
# ---------------------------------------------------------------------------
class TestScoping:
    def test_profile_autocreate(self, api_alice):
        r = api_alice.get(f"{BASE_URL}/api/profile")
        assert r.status_code == 200
        data = r.json()
        assert data.get("user_id") == UID_ALICE
        assert "id" in data and data["id"]

    def test_glucose_isolation(self, api_alice, api_bob):
        r1 = api_alice.post(f"{BASE_URL}/api/glucose", json={"value_mgdl": 142, "context": "avant-repas"})
        assert r1.status_code == 200
        gid_alice = r1.json()["id"]

        r2 = api_bob.post(f"{BASE_URL}/api/glucose", json={"value_mgdl": 95, "context": "a-jeun"})
        assert r2.status_code == 200

        la = api_alice.get(f"{BASE_URL}/api/glucose").json()
        lb = api_bob.get(f"{BASE_URL}/api/glucose").json()
        ids_a = {x["id"] for x in la}
        ids_b = {x["id"] for x in lb}
        assert gid_alice in ids_a
        assert gid_alice not in ids_b
        assert all(x["user_id"] == UID_ALICE for x in la)
        assert all(x["user_id"] == UID_BOB for x in lb)

    def test_meals_isolation(self, api_alice, api_bob):
        r1 = api_alice.post(f"{BASE_URL}/api/meals", json={
            "meal_type": "dejeuner", "carbs_g": 55, "insulin_units": 5.5, "name": "pates"
        })
        assert r1.status_code == 200
        mid = r1.json()["id"]
        lb = api_bob.get(f"{BASE_URL}/api/meals").json()
        assert mid not in {x["id"] for x in lb}

    def test_stats_scoping(self, api_alice, api_bob):
        # seed alice with several readings
        for v in [80, 110, 150, 200, 65]:
            api_alice.post(f"{BASE_URL}/api/glucose", json={"value_mgdl": v})
        rs_a = api_alice.get(f"{BASE_URL}/api/stats?days=7").json()
        rs_b = api_bob.get(f"{BASE_URL}/api/stats?days=7").json()
        assert rs_a["readings_count"] >= 5
        # bob only has 1 from previous test
        assert rs_b["readings_count"] < rs_a["readings_count"]
        # TIR sanity
        assert 0 <= rs_a["tir_in"] <= 100
        assert rs_a["est_hba1c"] is not None


# ---------------------------------------------------------------------------
# IA
# ---------------------------------------------------------------------------
class TestAI:
    def test_ai_models(self, api_alice):
        r = api_alice.get(f"{BASE_URL}/api/ai/models")
        assert r.status_code == 200
        data = r.json()
        assert data["default"] == "claude-sonnet-4-6"
        assert len(data["models"]) == 4

    def test_ai_chat_claude(self, api_alice):
        r = api_alice.post(f"{BASE_URL}/api/ai/chat",
                           json={"message": "Bonjour, donne-moi un conseil general.", "model": "claude-sonnet-4-6"},
                           timeout=90)
        assert r.status_code == 200, r.text
        reply = r.json().get("reply", "")
        assert isinstance(reply, str) and len(reply) > 10

    def test_ai_messages_history(self, api_alice):
        r = api_alice.get(f"{BASE_URL}/api/ai/messages")
        assert r.status_code == 200
        msgs = r.json()
        assert isinstance(msgs, list)
        roles = {m["role"] for m in msgs}
        assert "user" in roles and "assistant" in roles

    def test_ai_chat_gemini(self, api_alice):
        r = api_alice.post(f"{BASE_URL}/api/ai/chat",
                           json={"message": "En une phrase: c'est quoi un glucide?", "model": "gemini-3-flash"},
                           timeout=90)
        assert r.status_code == 200, r.text
        assert len(r.json().get("reply", "")) > 5

    def test_ai_messages_delete(self, api_alice):
        r = api_alice.delete(f"{BASE_URL}/api/ai/messages")
        assert r.status_code == 200
        msgs = api_alice.get(f"{BASE_URL}/api/ai/messages").json()
        assert msgs == []

    def test_ai_analyze_meal(self, api_alice):
        img_b64 = _make_food_image_b64()
        r = api_alice.post(f"{BASE_URL}/api/ai/analyze-meal",
                           json={"image_base64": img_b64}, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and isinstance(data["items"], list)
        assert "total_carbs_g" in data
        assert isinstance(data["total_carbs_g"], (int, float))
        assert 0 <= data["total_carbs_g"] <= 500
        assert "confidence" in data

    def test_weekly_summary_not_enough(self, api_bob):
        # bob has < 3 readings
        r = api_bob.get(f"{BASE_URL}/api/ai/weekly-summary", timeout=60)
        assert r.status_code == 400
        assert "mesures" in r.json().get("detail", "").lower() or "pas assez" in r.json().get("detail", "").lower()

    def test_weekly_summary_ok(self, api_alice):
        # Alice already has multiple readings from earlier
        r = api_alice.get(f"{BASE_URL}/api/ai/weekly-summary", timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data.get("summary"), str) and len(data["summary"]) > 30
        stats = data.get("stats", {})
        assert stats.get("count", 0) >= 3
        assert "avg" in stats and "tir" in stats


# ---------------------------------------------------------------------------
# CGM regression (invalid creds French errors)
# ---------------------------------------------------------------------------
class TestCGM:
    def test_libre_invalid_creds(self, api_alice):
        # configure libre with junk
        r = api_alice.post(f"{BASE_URL}/api/cgm/settings", json={
            "source": "libre", "region": "eu",
            "username": "does_not_exist_xyz@example.com", "password": "wrongpw123"
        })
        assert r.status_code == 200
        r = api_alice.post(f"{BASE_URL}/api/cgm/sync", timeout=60)
        assert r.status_code == 400
        detail = r.json().get("detail", "")
        assert "LibreLinkUp" in detail or "identifiants" in detail.lower()

    def test_nightscout_unreachable(self, api_alice):
        r = api_alice.post(f"{BASE_URL}/api/cgm/settings", json={
            "source": "nightscout", "region": "global",
            "nightscout_url": "https://nonexistent-nightscout-xyz-abc.example.com"
        })
        assert r.status_code == 200
        r = api_alice.post(f"{BASE_URL}/api/cgm/sync", timeout=60)
        assert r.status_code == 400
        detail = r.json().get("detail", "")
        assert "Nightscout" in detail or "injoignable" in detail.lower()


# ---------------------------------------------------------------------------
# Regression: foods DB
# ---------------------------------------------------------------------------
class TestFoods:
    def test_foods_list(self, api_alice):
        r = api_alice.get(f"{BASE_URL}/api/foods")
        assert r.status_code == 200
        foods = r.json()
        assert isinstance(foods, list)
        assert len(foods) >= 100
