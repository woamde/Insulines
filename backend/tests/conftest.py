import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

BACKEND_ENV = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(BACKEND_ENV)

# Public URL used by mobile app
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"] if "EXPO_PUBLIC_BACKEND_URL" in os.environ else None
if not BASE_URL:
    # Fallback: read from frontend/.env
    FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    for line in FRONTEND_ENV.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = BASE_URL.rstrip("/")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TOKEN_ALICE = "tok_alice_123"
TOKEN_BOB = "tok_bob_456"
UID_ALICE = "user_testalice"
UID_BOB = "user_testbob"


@pytest.fixture(scope="session")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="session", autouse=True)
def seed_users(mongo_db):
    """Insert test users + sessions directly."""
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=7)

    # Clean prior test data
    mongo_db.users.delete_many({"user_id": {"$in": [UID_ALICE, UID_BOB]}})
    mongo_db.user_sessions.delete_many({"session_token": {"$in": [TOKEN_ALICE, TOKEN_BOB]}})
    for uid in (UID_ALICE, UID_BOB):
        mongo_db.profiles.delete_many({"user_id": uid})
        mongo_db.glucose_readings.delete_many({"user_id": uid})
        mongo_db.meals.delete_many({"user_id": uid})
        mongo_db.ai_messages.delete_many({"user_id": uid})
        mongo_db.cgm_settings.delete_many({"user_id": uid})

    mongo_db.users.insert_many([
        {"user_id": UID_ALICE, "email": "alice@test.fr", "name": "Alice", "picture": "", "created_at": now},
        {"user_id": UID_BOB, "email": "bob@test.fr", "name": "Bob", "picture": "", "created_at": now},
    ])
    mongo_db.user_sessions.insert_many([
        {"session_token": TOKEN_ALICE, "user_id": UID_ALICE, "created_at": now, "expires_at": expires},
        {"session_token": TOKEN_BOB, "user_id": UID_BOB, "created_at": now, "expires_at": expires},
    ])
    yield
    # Teardown
    mongo_db.users.delete_many({"user_id": {"$in": [UID_ALICE, UID_BOB]}})
    mongo_db.user_sessions.delete_many({"session_token": {"$in": [TOKEN_ALICE, TOKEN_BOB]}})
    for uid in (UID_ALICE, UID_BOB):
        mongo_db.profiles.delete_many({"user_id": uid})
        mongo_db.glucose_readings.delete_many({"user_id": uid})
        mongo_db.meals.delete_many({"user_id": uid})
        mongo_db.ai_messages.delete_many({"user_id": uid})
        mongo_db.cgm_settings.delete_many({"user_id": uid})


@pytest.fixture
def api_alice():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {TOKEN_ALICE}", "Content-Type": "application/json"})
    return s


@pytest.fixture
def api_bob():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {TOKEN_BOB}", "Content-Type": "application/json"})
    return s


@pytest.fixture
def api_anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
