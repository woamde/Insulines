"""Iteration 10: account deletion hard checks (auth, purge isolation, storage erasure, retry paths)."""

import asyncio
import base64
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# backend + frontend env loading (public URL + mongo credentials)
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]

APP_NAME = "glycosoin-t1d"
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "https://integrations.emergentagent.com").rstrip("/")
STORAGE_URL = f"{STORAGE_BASE}/objstore/api/v1/storage"

PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z4WQAAAAASUVORK5CYII="
)


def _h(token: str):
    return {"Authorization": f"Bearer {token}"}


def _storage_key() -> str:
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    return resp.json()["storage_key"]


def _put_storage(path: str, data: bytes, content_type: str = "image/png"):
    key = _storage_key()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=60,
    )
    resp.raise_for_status()


def _get_storage_bytes(path: str) -> bytes:
    key = _storage_key()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content


async def _persist_session_same_email(email: str, token: str):
    import auth as auth_mod

    client = AsyncIOMotorClient(MONGO_URL, tz_aware=True)
    db = client[DB_NAME]
    auth_mod.init_auth(db)
    try:
        return await auth_mod.persist_session(email=email, name="Recreated", picture="", session_token=token)
    finally:
        client.close()


@pytest.fixture(scope="module")
def mongo_sync():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


@pytest.fixture(scope="module")
def disposable_accounts(mongo_sync):
    """Create dedicated disposable A/B/C accounts and sessions for deletion isolation testing."""
    tag = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)
    exp = now + timedelta(days=7)
    expired = now - timedelta(days=1)

    a_uid = f"user_delA_{tag}"
    b_uid = f"user_delB_{tag}"
    c_uid = f"user_delC_{tag}"

    a_email = f"del-a-{tag}@test.local"
    b_email = f"del-b-{tag}@test.local"
    c_email = f"del-c-{tag}@test.local"

    a_tok1 = f"tok_delA1_{tag}"
    a_tok2 = f"tok_delA2_{tag}"
    a_expired = f"tok_delA_expired_{tag}"
    b_tok = f"tok_delB_{tag}"
    c_tok = f"tok_delC_{tag}"

    users = [
        {"user_id": a_uid, "email": a_email, "name": "DeleteA", "picture": "", "created_at": now},
        {"user_id": b_uid, "email": b_email, "name": "DeleteB", "picture": "", "created_at": now},
        {"user_id": c_uid, "email": c_email, "name": "DeleteC", "picture": "", "created_at": now},
    ]
    sessions = [
        {"session_token": a_tok1, "user_id": a_uid, "created_at": now, "expires_at": exp},
        {"session_token": a_tok2, "user_id": a_uid, "created_at": now, "expires_at": exp},
        {"session_token": a_expired, "user_id": a_uid, "created_at": now, "expires_at": expired},
        {"session_token": b_tok, "user_id": b_uid, "created_at": now, "expires_at": exp},
        {"session_token": c_tok, "user_id": c_uid, "created_at": now, "expires_at": exp},
    ]
    mongo_sync.users.insert_many(users)
    mongo_sync.user_sessions.insert_many(sessions)

    # personal data spread across collections (including archived records)
    mongo_sync.profiles.insert_many([
        {"user_id": a_uid, "name": "TEST_A", "created_at": now},
        {"user_id": b_uid, "name": "TEST_B", "created_at": now},
        {"user_id": c_uid, "name": "TEST_C", "created_at": now},
    ])
    mongo_sync.glucose_readings.insert_many([
        {"user_id": a_uid, "value_mgdl": 120, "deleted_at": None, "measured_at": now, "created_at": now},
        {"user_id": a_uid, "value_mgdl": 95, "deleted_at": now, "measured_at": now, "created_at": now},
        {"user_id": b_uid, "value_mgdl": 130, "deleted_at": None, "measured_at": now, "created_at": now},
    ])
    mongo_sync.reminders.insert_many([
        {"user_id": a_uid, "reminders": [], "updated_at": now},
        {"user_id": b_uid, "reminders": [], "updated_at": now},
    ])
    mongo_sync.report_emails.insert_one({"user_id": a_uid, "sent_at": now})
    mongo_sync.ai_messages.insert_one({"user_id": a_uid, "role": "user", "content": "TEST_hello", "created_at": now})
    mongo_sync.ai_coach_reports.insert_one({"user_id": a_uid, "report": {"overview": "TEST"}, "created_at": now})
    mongo_sync.cgm_settings.insert_one({"user_id": a_uid, "source": "libre", "updated_at": now})
    mongo_sync.insulin_doses.insert_one({"user_id": a_uid, "units": 5, "kind": "basale", "created_at": now, "deleted_at": None})
    mongo_sync.weight_entries.insert_one({"user_id": a_uid, "weight_kg": 71, "created_at": now, "deleted_at": None, "measured_at": now})
    mongo_sync.activities.insert_one({"user_id": a_uid, "activity_type": "marche", "duration_min": 30, "created_at": now, "deleted_at": None, "started_at": now})

    # public share links for A/B/C
    a_share_token = f"shareA_{tag}_{uuid.uuid4().hex[:20]}"
    b_share_token = f"shareB_{tag}_{uuid.uuid4().hex[:20]}"
    c_share_token = f"shareC_{tag}_{uuid.uuid4().hex[:20]}"
    mongo_sync.share_links.insert_many([
        {"user_id": a_uid, "token": a_share_token, "label": "A", "created_at": now, "revoked_at": None, "views": 0},
        {"user_id": b_uid, "token": b_share_token, "label": "B", "created_at": now, "revoked_at": None, "views": 0},
        {"user_id": c_uid, "token": c_share_token, "label": "C", "created_at": now, "revoked_at": None, "views": 0},
    ])

    data = {
        "tag": tag,
        "a": {"uid": a_uid, "email": a_email, "tok1": a_tok1, "tok2": a_tok2, "expired": a_expired, "share": a_share_token},
        "b": {"uid": b_uid, "email": b_email, "tok": b_tok, "share": b_share_token},
        "c": {"uid": c_uid, "email": c_email, "tok": c_tok, "share": c_share_token},
        "created_paths": [],
        "new_tokens": [],
        "recreated_user_ids": [],
    }

    yield data

    # teardown test-created users/tokens/data (best effort)
    uids = [a_uid, b_uid, c_uid, *data["recreated_user_ids"]]
    for name in mongo_sync.list_collection_names():
        if name.startswith("system."):
            continue
        mongo_sync[name].delete_many({"user_id": {"$in": uids}})
    toks = [a_tok1, a_tok2, a_expired, b_tok, c_tok, *data["new_tokens"]]
    mongo_sync.user_sessions.delete_many({"session_token": {"$in": toks}})
    mongo_sync.users.delete_many({"user_id": {"$in": uids}})


# auth guard + payload validation checks around DELETE /api/auth/account
def test_delete_requires_auth_and_exact_confirmation(disposable_accounts):
    a = disposable_accounts["a"]
    r = requests.delete(
        f"{BASE_URL}/api/auth/account",
        json={"confirmation": "SUPPRIMER"},
        timeout=20,
    )
    assert r.status_code == 401

    r = requests.delete(
        f"{BASE_URL}/api/auth/account",
        headers=_h("definitely-invalid"),
        json={"confirmation": "SUPPRIMER"},
        timeout=20,
    )
    assert r.status_code == 401

    r = requests.delete(
        f"{BASE_URL}/api/auth/account",
        headers=_h(a["expired"]),
        json={"confirmation": "SUPPRIMER"},
        timeout=20,
    )
    assert r.status_code == 401

    r = requests.delete(f"{BASE_URL}/api/auth/account", headers=_h(a["tok1"]), json={}, timeout=20)
    assert r.status_code == 422

    r = requests.delete(
        f"{BASE_URL}/api/auth/account",
        headers=_h(a["tok1"]),
        json={"confirmation": "SUPPRIME"},
        timeout=20,
    )
    assert r.status_code == 422

    r = requests.delete(
        f"{BASE_URL}/api/auth/account",
        headers=_h(a["tok1"]),
        json={"confirmation": "SUPPRIMER", "user_id": "hacker", "email": "x@test.local"},
        timeout=20,
    )
    assert r.status_code == 422


# real upload + files + foreign photo rejection + full A deletion isolation
def test_real_storage_and_full_a_erasure(mongo_sync, disposable_accounts):
    a = disposable_accounts["a"]
    b = disposable_accounts["b"]
    now = datetime.now(timezone.utc)

    upload_linked = requests.post(
        f"{BASE_URL}/api/upload",
        headers=_h(a["tok1"]),
        files={"file": ("tiny-a.png", PNG_BYTES, "image/png")},
        timeout=40,
    )
    assert upload_linked.status_code == 200, upload_linked.text
    linked_path = upload_linked.json()["path"]
    linked_url = f"{BASE_URL}/api/files/{linked_path}"

    upload_abandoned = requests.post(
        f"{BASE_URL}/api/upload",
        headers=_h(a["tok1"]),
        files={"file": ("tiny-a2.png", PNG_BYTES, "image/png")},
        timeout=40,
    )
    assert upload_abandoned.status_code == 200, upload_abandoned.text
    abandoned_path = upload_abandoned.json()["path"]
    abandoned_url = f"{BASE_URL}/api/files/{abandoned_path}"

    # public file route should serve bytes before deletion
    r = requests.get(linked_url, timeout=30)
    assert r.status_code == 200 and len(r.content) > 0
    r = requests.get(abandoned_url, timeout=30)
    assert r.status_code == 200 and len(r.content) > 0

    # linked meal + foreign-photo rejection
    meal = requests.post(
        f"{BASE_URL}/api/meals",
        headers={**_h(a["tok1"]), "Content-Type": "application/json"},
        json={"name": "TEST_meal_A", "carbs_g": 12, "photo_path": linked_path},
        timeout=20,
    )
    assert meal.status_code == 200, meal.text

    foreign = requests.post(
        f"{BASE_URL}/api/meals",
        headers={**_h(b["tok"]), "Content-Type": "application/json"},
        json={"name": "TEST_foreign", "carbs_g": 10, "photo_path": linked_path},
        timeout=20,
    )
    assert foreign.status_code == 400

    # legacy photo path not present in uploads, attached to soft-deleted meal
    legacy_path = f"{APP_NAME}/uploads/{a['uid']}/legacy-{uuid.uuid4().hex}.png"
    _put_storage(legacy_path, PNG_BYTES, "image/png")
    mongo_sync.meals.insert_one(
        {
            "user_id": a["uid"],
            "name": "TEST_legacy_soft_deleted",
            "photo_path": legacy_path,
            "carbs_g": 0,
            "eaten_at": now,
            "created_at": now,
            "deleted_at": now,
        }
    )

    # ensure A/B public shares are available before deletion
    r = requests.get(f"{BASE_URL}/api/shared/{a['share']}", timeout=20)
    assert r.status_code == 200
    r = requests.get(f"{BASE_URL}/api/shared/{b['share']}", timeout=20)
    assert r.status_code == 200

    # delete A account
    deleted = requests.delete(
        f"{BASE_URL}/api/auth/account",
        headers={**_h(a["tok1"]), "Content-Type": "application/json"},
        json={"confirmation": "SUPPRIMER"},
        timeout=60,
    )
    assert deleted.status_code == 200, deleted.text

    # all A tokens invalidated
    for tok in (a["tok1"], a["tok2"]):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tok), timeout=20)
        assert r.status_code == 401

    # A data absent in all user_id-scoped collections
    for name in mongo_sync.list_collection_names():
        if name.startswith("system."):
            continue
        assert mongo_sync[name].count_documents({"user_id": a["uid"]}) == 0, f"A data remains in {name}"

    # user identity removed
    assert mongo_sync.users.count_documents({"user_id": a["uid"]}) == 0
    assert mongo_sync.user_sessions.count_documents({"user_id": a["uid"]}) == 0

    # A share dead, B share still operational
    r = requests.get(f"{BASE_URL}/api/shared/{a['share']}", timeout=20)
    assert r.status_code == 404
    r = requests.get(f"{BASE_URL}/api/shared/{b['share']}", timeout=20)
    assert r.status_code == 200

    # B still authenticated/operational
    r = requests.get(f"{BASE_URL}/api/profile", headers=_h(b["tok"]), timeout=20)
    assert r.status_code == 200

    # public photo URLs must be 404 after A deletion
    assert requests.get(linked_url, timeout=20).status_code == 404
    assert requests.get(abandoned_url, timeout=20).status_code == 404
    assert requests.get(f"{BASE_URL}/api/files/{legacy_path}", timeout=20).status_code == 404

    # upstream objects are overwritten with empty bytes (managed storage no DELETE)
    assert len(_get_storage_bytes(linked_path)) == 0
    assert len(_get_storage_bytes(abandoned_path)) == 0
    assert len(_get_storage_bytes(legacy_path)) == 0

    # fresh persist_session same e-mail => NEW user_id, no historical data
    new_token = f"tok_recreate_{disposable_accounts['tag']}"
    recreated = asyncio.run(_persist_session_same_email(a["email"], new_token))
    disposable_accounts["recreated_user_ids"].append(recreated["user_id"])
    disposable_accounts["new_tokens"].append(new_token)
    assert recreated["user_id"] != a["uid"]

    me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(new_token), timeout=20)
    assert me.status_code == 200
    assert me.json()["user_id"] == recreated["user_id"]

    # no old data resurrected on recreated account
    gluc = requests.get(f"{BASE_URL}/api/glucose", headers=_h(new_token), timeout=20)
    assert gluc.status_code == 200
    assert gluc.json() == []

    # idempotent auth regression still holds
    recreated2 = asyncio.run(_persist_session_same_email(a["email"], new_token))
    assert recreated2["user_id"] == recreated["user_id"]


# isolated failure/retry path: force deletion failure, verify pending gate behavior, then retry success
def test_deletion_failure_sets_pending_and_blocks_until_retry(mongo_sync, disposable_accounts):
    c = disposable_accounts["c"]
    now = datetime.now(timezone.utc)

    # one valid upload for C -> should be blocked publicly while pending
    up = requests.post(
        f"{BASE_URL}/api/upload",
        headers=_h(c["tok"]),
        files={"file": ("tiny-c.png", PNG_BYTES, "image/png")},
        timeout=40,
    )
    assert up.status_code == 200, up.text
    c_path = up.json()["path"]

    # inject failing path recognized by erase_photos guard (isolated fault trigger)
    mongo_sync.uploads.insert_one({"user_id": c["uid"], "path": "bad/path", "created_at": now})

    failing = requests.delete(
        f"{BASE_URL}/api/auth/account",
        headers={**_h(c["tok"]), "Content-Type": "application/json"},
        json={"confirmation": "SUPPRIMER"},
        timeout=40,
    )
    assert failing.status_code == 503

    # identity + session retained for retry
    user = mongo_sync.users.find_one({"user_id": c["uid"]})
    assert user is not None
    assert user.get("account_deletion_pending") is True
    assert mongo_sync.user_sessions.count_documents({"user_id": c["uid"]}) >= 1

    # other authenticated APIs blocked by 409 while pending
    blocked = requests.get(f"{BASE_URL}/api/profile", headers=_h(c["tok"]), timeout=20)
    assert blocked.status_code == 409

    # public share/photo blocked while pending
    assert requests.get(f"{BASE_URL}/api/shared/{c['share']}", timeout=20).status_code == 404
    assert requests.get(f"{BASE_URL}/api/files/{c_path}", timeout=20).status_code == 404

    # retry succeeds once faulty path removed
    mongo_sync.uploads.delete_many({"user_id": c["uid"], "path": "bad/path"})
    retried = requests.delete(
        f"{BASE_URL}/api/auth/account",
        headers={**_h(c["tok"]), "Content-Type": "application/json"},
        json={"confirmation": "SUPPRIMER"},
        timeout=60,
    )
    assert retried.status_code == 200, retried.text
    assert requests.get(f"{BASE_URL}/api/auth/me", headers=_h(c["tok"]), timeout=20).status_code == 401


# concurrent duplicate deletion should not corrupt other account data
def test_concurrent_duplicate_delete_isolated(mongo_sync):
    tag = uuid.uuid4().hex[:8]
    uid = f"user_dupdel_{tag}"
    email = f"dupdel-{tag}@test.local"
    token = f"tok_dupdel_{tag}"
    now = datetime.now(timezone.utc)

    mongo_sync.users.insert_one({"user_id": uid, "email": email, "name": "DupDel", "picture": "", "created_at": now})
    mongo_sync.user_sessions.insert_one(
        {"session_token": token, "user_id": uid, "created_at": now, "expires_at": now + timedelta(days=7)}
    )

    def _delete_once():
        return requests.delete(
            f"{BASE_URL}/api/auth/account",
            headers={**_h(token), "Content-Type": "application/json"},
            json={"confirmation": "SUPPRIMER"},
            timeout=60,
        ).status_code

    loop = asyncio.new_event_loop()
    try:
        statuses = loop.run_until_complete(asyncio.gather(
            loop.run_in_executor(None, _delete_once),
            loop.run_in_executor(None, _delete_once),
        ))
    finally:
        loop.close()

    assert 200 in statuses
    assert any(code in (401, 200) for code in statuses)

    # account truly deleted, no leftovers
    assert mongo_sync.users.count_documents({"user_id": uid}) == 0
    assert mongo_sync.user_sessions.count_documents({"user_id": uid}) == 0
