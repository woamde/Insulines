"""Iteration 8 — Bug fix: `auth.persist_session` idempotent.

Emergent OAuth peut renvoyer le même session_token lors d'une reconnexion :
un insert brut lèverait DuplicateKeyError (index unique) → 500.
Le fix (`upsert user par email normalisé + upsert session par jeton`) doit être vérifié.

Tests :
  a) même token + même e-mail (casse différente) 2x → aucune exception,
     1 seul doc user_sessions pour ce jeton, 1 seul user, même user_id, expires_at renouvelé
  b) 2 tokens différents pour le même e-mail → 2 sessions, 1 user
  c) le token stocké est accepté par GET /api/auth/me (200, e-mail en minuscules)
  d) POST /api/auth/session avec session_id invalide → 401 "Connexion Google échouée" (jamais 500)
     et POST sans session_id → 422
  e) Régression : endpoints protégés sans Bearer → 401 ; avec devtest_token_123 → 200
  f) GET /api/ai/models avec Bearer → 200 (liste de modèles)
"""
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).parents[1]))
sys.path.insert(0, str(Path(__file__).parent))

from conftest import BASE_URL  # noqa: E402

DEV_TOKEN = "devtest_token_123"
DUP_EMAIL_UPPER = "Dup.Test@Example.com"
DUP_EMAIL_LOWER = "dup.test@example.com"
DUP_TOKEN_SAME = "iter8_dup_same_token"
DUP_TOKEN_A = "iter8_dup_token_a"
DUP_TOKEN_B = "iter8_dup_token_b"


# --------------------------------------------------------------------------
# (a) + (b) : unit test direct de auth.persist_session
# --------------------------------------------------------------------------
@pytest.fixture
def mongo_sync(mongo_db):
    """Cleanup helper — nettoie les enregistrements de test avant/après."""
    def _clean():
        mongo_db.users.delete_many({"email": DUP_EMAIL_LOWER})
        mongo_db.user_sessions.delete_many({
            "session_token": {"$in": [DUP_TOKEN_SAME, DUP_TOKEN_A, DUP_TOKEN_B]}
        })
    _clean()
    yield mongo_db
    _clean()


def _run_persist(email, name, token):
    """Exécute auth.persist_session dans une event loop dédiée avec son propre client Motor."""
    from motor.motor_asyncio import AsyncIOMotorClient
    import auth as auth_mod

    async def _do():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"], tz_aware=True)
        db = client[os.environ["DB_NAME"]]
        auth_mod.init_auth(db)
        try:
            return await auth_mod.persist_session(
                email=email, name=name, picture="", session_token=token
            )
        finally:
            client.close()

    return asyncio.run(_do())


class TestPersistSessionIdempotent:
    def test_same_token_same_email_different_case(self, mongo_sync):
        """(a) 2 appels : même token + même e-mail (casse différente) → 1 user, 1 session, user_id stable, expires_at renouvelé."""
        u1 = _run_persist(DUP_EMAIL_UPPER, "Dup Upper", DUP_TOKEN_SAME)
        sess1 = mongo_sync.user_sessions.find_one({"session_token": DUP_TOKEN_SAME})
        assert sess1 is not None
        expires1 = sess1["expires_at"]

        # petit délai pour vérifier le renouvellement d'expires_at
        import time as _t
        _t.sleep(1.1)

        u2 = _run_persist(DUP_EMAIL_LOWER, "Dup Lower", DUP_TOKEN_SAME)

        # Un seul user (email normalisé)
        users = list(mongo_sync.users.find({"email": DUP_EMAIL_LOWER}))
        assert len(users) == 1, f"attendu 1 user, trouvé {len(users)}"
        assert u1["user_id"] == u2["user_id"], "user_id doit rester stable"
        assert u1["email"] == DUP_EMAIL_LOWER, "email doit être normalisé en minuscules"

        # Un seul document session pour ce token
        sessions = list(mongo_sync.user_sessions.find({"session_token": DUP_TOKEN_SAME}))
        assert len(sessions) == 1, f"attendu 1 session, trouvé {len(sessions)}"

        # expires_at renouvelé
        expires2 = sessions[0]["expires_at"]
        if expires1.tzinfo is None:
            expires1 = expires1.replace(tzinfo=timezone.utc)
        if expires2.tzinfo is None:
            expires2 = expires2.replace(tzinfo=timezone.utc)
        assert expires2 > expires1, f"expires_at doit être renouvelé ({expires1} → {expires2})"

        # ~ +7 jours (dans une fenêtre large)
        delta = (expires2 - datetime.now(timezone.utc)).total_seconds()
        assert 6.5 * 86400 < delta < 7.5 * 86400, f"expires_at ~ +7j attendu, delta={delta/86400:.2f} j"

    def test_two_tokens_same_email(self, mongo_sync):
        """(b) 2 tokens différents pour le même e-mail → 2 sessions, 1 user."""
        u1 = _run_persist(DUP_EMAIL_UPPER, "Dup", DUP_TOKEN_A)
        u2 = _run_persist(DUP_EMAIL_LOWER, "Dup", DUP_TOKEN_B)

        users = list(mongo_sync.users.find({"email": DUP_EMAIL_LOWER}))
        assert len(users) == 1
        assert u1["user_id"] == u2["user_id"]

        sessions = list(mongo_sync.user_sessions.find(
            {"session_token": {"$in": [DUP_TOKEN_A, DUP_TOKEN_B]}}
        ))
        assert len(sessions) == 2
        assert {s["user_id"] for s in sessions} == {u1["user_id"]}

    def test_c_token_accepted_by_auth_me(self, mongo_sync):
        """(c) GET /api/auth/me avec Bearer <token> → 200, email en minuscules."""
        _run_persist(DUP_EMAIL_UPPER, "Dup", DUP_TOKEN_SAME)
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {DUP_TOKEN_SAME}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        me = r.json()
        assert me["email"] == DUP_EMAIL_LOWER
        assert me["user_id"].startswith("user_")


# --------------------------------------------------------------------------
# (d) POST /api/auth/session : jamais 500
# --------------------------------------------------------------------------
class TestAuthSessionEndpoint:
    def test_invalid_session_id_returns_401(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/session",
            json={"session_id": "invalide"},
            timeout=20,
        )
        assert r.status_code == 401, f"attendu 401, obtenu {r.status_code} — body={r.text}"
        detail = r.json().get("detail", "")
        assert detail == "Connexion Google échouée", detail
        assert r.status_code != 500

    def test_missing_body_returns_422(self):
        r = requests.post(f"{BASE_URL}/api/auth/session", json={}, timeout=10)
        assert r.status_code == 422, r.text


# --------------------------------------------------------------------------
# (e) Régression : protégé sans Bearer → 401 ; avec devtest_token_123 → 200
# --------------------------------------------------------------------------
class TestProtectedEndpointsRegression:
    def test_profile_without_bearer_401(self):
        r = requests.get(f"{BASE_URL}/api/profile", timeout=10)
        assert r.status_code == 401

    def test_profile_with_devtest_token_200(self):
        r = requests.get(
            f"{BASE_URL}/api/profile",
            headers={"Authorization": f"Bearer {DEV_TOKEN}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # champ user_id/profil doit exister
        assert "target_low" in body and "target_high" in body


# --------------------------------------------------------------------------
# (f) GET /api/ai/models avec Bearer → 200 liste
# --------------------------------------------------------------------------
class TestAiModels:
    def test_ai_models_ok(self):
        r = requests.get(
            f"{BASE_URL}/api/ai/models",
            headers={"Authorization": f"Bearer {DEV_TOKEN}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Accepte soit une liste, soit un objet contenant une liste
        if isinstance(data, dict):
            candidates = None
            for k in ("models", "items", "data"):
                if isinstance(data.get(k), list):
                    candidates = data[k]
                    break
            assert candidates and len(candidates) > 0, f"aucun modèle dans la réponse: {data}"
        else:
            assert isinstance(data, list) and len(data) > 0, data
