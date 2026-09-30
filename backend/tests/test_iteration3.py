"""Iteration 3 backend tests: insulin, weight, reminders, PDF report, CGM regression."""
import pytest

from conftest import BASE_URL, UID_ALICE, UID_BOB


# ---------------------------------------------------------------------------
# AUTH gating for new endpoints
# ---------------------------------------------------------------------------
class TestNewEndpointsGating:
    @pytest.mark.parametrize("method,path,payload", [
        ("get", "/api/insulin", None),
        ("post", "/api/insulin", {"units": 10, "kind": "basale"}),
        ("get", "/api/weight", None),
        ("post", "/api/weight", {"weight_kg": 72}),
        ("get", "/api/reminders", None),
        ("put", "/api/reminders", {"reminders": []}),
        ("get", "/api/report/pdf", None),
    ])
    def test_requires_auth(self, api_anon, method, path, payload):
        fn = getattr(api_anon, method)
        r = fn(f"{BASE_URL}{path}", json=payload) if payload is not None else fn(f"{BASE_URL}{path}")
        assert r.status_code == 401, f"{method.upper()} {path} -> {r.status_code}"


# ---------------------------------------------------------------------------
# INSULIN
# ---------------------------------------------------------------------------
class TestInsulin:
    def test_add_basale_ok(self, api_alice, mongo_db):
        mongo_db.insulin_doses.delete_many({"user_id": UID_ALICE})
        r = api_alice.post(f"{BASE_URL}/api/insulin",
                           json={"units": 18, "kind": "basale", "insulin_name": "Lantus", "note": "soir"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data and data["id"]
        assert data["units"] == 18
        assert data["kind"] == "basale"
        assert data["insulin_name"] == "Lantus"
        # ISO tz-aware
        assert data["injected_at"].endswith("+00:00") or "Z" in data["injected_at"] or "+" in data["injected_at"]

    def test_add_bolus_ok(self, api_alice):
        r = api_alice.post(f"{BASE_URL}/api/insulin",
                           json={"units": 4.5, "kind": "bolus", "insulin_name": "Novorapid"})
        assert r.status_code == 200
        assert r.json()["kind"] == "bolus"

    def test_units_out_of_range(self, api_alice):
        for units in (0, -1, 201, 500):
            r = api_alice.post(f"{BASE_URL}/api/insulin", json={"units": units, "kind": "basale"})
            assert r.status_code == 400, f"units={units} -> {r.status_code}"

    def test_invalid_kind(self, api_alice):
        r = api_alice.post(f"{BASE_URL}/api/insulin", json={"units": 5, "kind": "pump"})
        assert r.status_code == 400

    def test_list_desc(self, api_alice):
        docs = api_alice.get(f"{BASE_URL}/api/insulin").json()
        assert isinstance(docs, list)
        assert len(docs) >= 2
        times = [d["injected_at"] for d in docs]
        assert times == sorted(times, reverse=True)

    def test_soft_delete(self, api_alice):
        r = api_alice.post(f"{BASE_URL}/api/insulin", json={"units": 3, "kind": "correction"})
        did = r.json()["id"]
        d = api_alice.delete(f"{BASE_URL}/api/insulin/{did}")
        assert d.status_code == 200
        remaining = {x["id"] for x in api_alice.get(f"{BASE_URL}/api/insulin").json()}
        assert did not in remaining

    def test_isolation_alice_bob(self, api_alice, api_bob):
        r = api_alice.post(f"{BASE_URL}/api/insulin", json={"units": 12, "kind": "basale"})
        aid = r.json()["id"]
        bob_ids = {x["id"] for x in api_bob.get(f"{BASE_URL}/api/insulin").json()}
        assert aid not in bob_ids


# ---------------------------------------------------------------------------
# WEIGHT
# ---------------------------------------------------------------------------
class TestWeight:
    def test_add_weight_ok(self, api_alice, mongo_db):
        mongo_db.weight_entries.delete_many({"user_id": UID_ALICE})
        r = api_alice.post(f"{BASE_URL}/api/weight", json={"weight_kg": 72.5, "note": "matin"})
        assert r.status_code == 200
        data = r.json()
        assert data["weight_kg"] == 72.5
        assert "id" in data

    def test_out_of_range(self, api_alice):
        for w in (19, 401, 0):
            r = api_alice.post(f"{BASE_URL}/api/weight", json={"weight_kg": w})
            assert r.status_code == 400, f"weight={w} -> {r.status_code}"

    def test_profile_reflects_last(self, api_alice):
        # Ensure profile document exists first (auto-create via GET)
        api_alice.get(f"{BASE_URL}/api/profile")
        r = api_alice.post(f"{BASE_URL}/api/weight", json={"weight_kg": 73.2})
        assert r.status_code == 200
        p = api_alice.get(f"{BASE_URL}/api/profile").json()
        assert p["weight_kg"] == 73.2

    def test_list_and_delete(self, api_alice):
        r = api_alice.post(f"{BASE_URL}/api/weight", json={"weight_kg": 71.0})
        wid = r.json()["id"]
        items = api_alice.get(f"{BASE_URL}/api/weight").json()
        assert any(x["id"] == wid for x in items)
        d = api_alice.delete(f"{BASE_URL}/api/weight/{wid}")
        assert d.status_code == 200
        after = {x["id"] for x in api_alice.get(f"{BASE_URL}/api/weight").json()}
        assert wid not in after


# ---------------------------------------------------------------------------
# REMINDERS
# ---------------------------------------------------------------------------
class TestReminders:
    def test_default_reminders(self, api_alice, mongo_db):
        mongo_db.reminders.delete_many({"user_id": UID_ALICE})
        r = api_alice.get(f"{BASE_URL}/api/reminders")
        assert r.status_code == 200
        rem = r.json()["reminders"]
        assert len(rem) == 5
        kinds = [x["kind"] for x in rem]
        assert kinds.count("glucose") == 4
        assert kinds.count("basale") == 1

    def test_save_ok(self, api_alice):
        payload = {"reminders": [
            {"id": "reveil", "label": "Réveil", "hour": 7, "minute": 45, "enabled": True, "kind": "glucose"},
            {"id": "basale", "label": "Basale", "hour": 21, "minute": 0, "enabled": False, "kind": "basale"},
        ]}
        r = api_alice.put(f"{BASE_URL}/api/reminders", json=payload)
        assert r.status_code == 200
        got = api_alice.get(f"{BASE_URL}/api/reminders").json()["reminders"]
        assert len(got) == 2
        assert got[0]["hour"] == 7 and got[0]["minute"] == 45

    def test_invalid_hour(self, api_alice):
        r = api_alice.put(f"{BASE_URL}/api/reminders", json={"reminders": [
            {"id": "x", "label": "X", "hour": 25, "minute": 0, "enabled": True, "kind": "glucose"}
        ]})
        assert r.status_code == 400

    def test_invalid_kind(self, api_alice):
        r = api_alice.put(f"{BASE_URL}/api/reminders", json={"reminders": [
            {"id": "x", "label": "X", "hour": 7, "minute": 0, "enabled": True, "kind": "insuline"}
        ]})
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# STATS: basal/bolus/weight aggregates
# ---------------------------------------------------------------------------
class TestStatsAggregates:
    def test_aggregates(self, api_alice, mongo_db):
        # Reset relevant collections for alice, then seed
        mongo_db.insulin_doses.delete_many({"user_id": UID_ALICE})
        mongo_db.weight_entries.delete_many({"user_id": UID_ALICE})
        mongo_db.meals.delete_many({"user_id": UID_ALICE})
        # 2 basale + 1 bolus injection + meal with insulin_units 5 -> bolus_total = 5+3 = 8
        api_alice.post(f"{BASE_URL}/api/insulin", json={"units": 20, "kind": "basale"})
        api_alice.post(f"{BASE_URL}/api/insulin", json={"units": 18, "kind": "basale"})
        api_alice.post(f"{BASE_URL}/api/insulin", json={"units": 3, "kind": "correction"})
        api_alice.post(f"{BASE_URL}/api/meals", json={"carbs_g": 60, "insulin_units": 5, "name": "test"})
        api_alice.post(f"{BASE_URL}/api/weight", json={"weight_kg": 70})
        api_alice.post(f"{BASE_URL}/api/weight", json={"weight_kg": 71.5})

        s = api_alice.get(f"{BASE_URL}/api/stats?days=7").json()
        assert s["basal_total"] == 38.0
        assert s["bolus_total"] == 8.0
        assert s["basal_daily_avg"] == round(38.0 / 7, 1)
        assert s["weight_count"] == 2
        assert s["weight_start"] == 70
        assert s["weight_end"] == 71.5
        assert s["weight_delta"] == 1.5


# ---------------------------------------------------------------------------
# PDF REPORT
# ---------------------------------------------------------------------------
class TestReportPDF:
    @pytest.mark.parametrize("days", [14, 30, 90])
    def test_pdf_ok(self, api_alice, days):
        # Note: session already has Content-Type json header; but for GET it doesn't matter.
        r = api_alice.get(f"{BASE_URL}/api/report/pdf?days={days}&tz=Europe/Paris", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd.lower()

    def test_pdf_for_empty_user(self, api_bob):
        # Bob has minimal / no insulin/weights; PDF should still generate
        r = api_bob.get(f"{BASE_URL}/api/report/pdf?days=90&tz=Europe/Paris", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert r.content[:4] == b"%PDF"


# ---------------------------------------------------------------------------
# CGM LibreLinkUp: real error French message
# ---------------------------------------------------------------------------
class TestCgmLibreError:
    def test_libre_bad_creds(self, api_alice):
        r = api_alice.post(f"{BASE_URL}/api/cgm/settings", json={
            "source": "libre", "region": "fr",
            "username": "notreal_glycosoin@example.com", "password": "wrongpwd"
        })
        assert r.status_code == 200
        r = api_alice.post(f"{BASE_URL}/api/cgm/sync", timeout=60)
        assert r.status_code == 400
        detail = r.json().get("detail", "")
        assert "LibreLinkUp" in detail or "identifiants" in detail.lower()
        # status echoes the same error
        st = api_alice.get(f"{BASE_URL}/api/cgm/status").json()
        assert st.get("last_error") == detail
