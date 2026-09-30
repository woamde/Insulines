"""Iteration 11: local web/PWA privacy checks + disposable auth regression flows.

- Module A: API headers + auth-gated medical flow with disposable identity.
- Module B: register_local_web static serving security/deeplink behavior.
- Module C: web export/source archive privacy checks.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zipfile import ZipFile

import pytest
import requests
import yaml
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pymongo import MongoClient


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from web_app import register_local_web


ROOT = Path(__file__).resolve().parents[2]
BACKEND_ENV = Path(__file__).resolve().parents[1] / ".env"
FRONTEND_ENV = ROOT / "frontend" / ".env"

load_dotenv(BACKEND_ENV)
load_dotenv(FRONTEND_ENV)

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def mongo_db_local():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


@pytest.fixture(scope="module")
def disposable_identity(mongo_db_local):
    """Create disposable user/session for full gated flow; remove everything afterwards."""
    tag = uuid.uuid4().hex[:10]
    uid = f"user_iter11_{tag}"
    token = f"tok_iter11_{tag}"
    email = f"iter11-{tag}@test.local"
    now = datetime.now(timezone.utc)

    mongo_db_local.users.insert_one({
        "user_id": uid,
        "email": email,
        "name": "Iter11",
        "picture": "",
        "created_at": now,
    })
    mongo_db_local.user_sessions.insert_one({
        "session_token": token,
        "user_id": uid,
        "created_at": now,
        "expires_at": now + timedelta(days=7),
    })

    yield {"uid": uid, "token": token, "email": email}

    for col in mongo_db_local.list_collection_names():
        if col.startswith("system."):
            continue
        mongo_db_local[col].delete_many({"user_id": uid})
    mongo_db_local.user_sessions.delete_many({"session_token": token})
    mongo_db_local.users.delete_many({"user_id": uid})


# ---------------------------------------------------------------------------
# Module A — API auth gate + disposable regression flow
# ---------------------------------------------------------------------------
def test_api_private_responses_are_no_store_and_unknown_api_404_json():
    res = requests.get(f"{BASE_URL}/api/", timeout=20)
    assert res.status_code == 200
    assert "no-store" in (res.headers.get("Cache-Control") or "")
    assert "no-cache" in (res.headers.get("Pragma") or "")

    missing = requests.get(f"{BASE_URL}/api/does-not-exist-iter11", timeout=20)
    assert missing.status_code == 404
    data = missing.json()
    assert isinstance(data.get("detail"), str) and data["detail"]


def test_login_gate_requires_session_token():
    res = requests.get(f"{BASE_URL}/api/profile", timeout=20)
    assert res.status_code == 401


def test_profile_update_and_get_persistence(disposable_identity):
    tok = disposable_identity["token"]
    payload = {
        "name": "TEST_Iter11 Name",
        "glucose_unit": "mgdl",
        "target_low": 75,
        "target_high": 170,
    }
    upd = requests.put(f"{BASE_URL}/api/profile", headers=_auth(tok), json=payload, timeout=20)
    assert upd.status_code == 200, upd.text

    got = requests.get(f"{BASE_URL}/api/profile", headers=_auth(tok), timeout=20)
    assert got.status_code == 200
    profile = got.json()
    assert profile["name"] == payload["name"]
    assert profile["target_low"] == payload["target_low"]
    assert profile["target_high"] == payload["target_high"]


def test_glucose_create_list_delete_persistence(disposable_identity):
    tok = disposable_identity["token"]
    created = requests.post(
        f"{BASE_URL}/api/glucose",
        headers=_auth(tok),
        json={"value_mgdl": 123, "context": "avant-repas", "note": "TEST_iter11"},
        timeout=20,
    )
    assert created.status_code == 200, created.text
    gid = created.json()["id"]

    listed = requests.get(f"{BASE_URL}/api/glucose?limit=50", headers=_auth(tok), timeout=20)
    assert listed.status_code == 200
    ids = {row["id"] for row in listed.json()}
    assert gid in ids

    deleted = requests.delete(f"{BASE_URL}/api/glucose/{gid}", headers=_auth(tok), timeout=20)
    assert deleted.status_code == 200

    listed_after = requests.get(f"{BASE_URL}/api/glucose?limit=50", headers=_auth(tok), timeout=20)
    assert listed_after.status_code == 200
    ids_after = {row["id"] for row in listed_after.json()}
    assert gid not in ids_after


def test_stats_pdf_and_cgm_settings_status_auth(disposable_identity):
    tok = disposable_identity["token"]

    # Ensure at least one point for stats
    add = requests.post(
        f"{BASE_URL}/api/glucose",
        headers=_auth(tok),
        json={"value_mgdl": 140, "context": "apres-repas", "note": "TEST_stats"},
        timeout=20,
    )
    assert add.status_code == 200

    stats = requests.get(f"{BASE_URL}/api/stats?days=7", headers=_auth(tok), timeout=20)
    assert stats.status_code == 200
    assert stats.json()["readings_count"] >= 1

    pdf = requests.get(f"{BASE_URL}/api/report/pdf?days=7&tz=Europe/Paris", headers=_auth(tok), timeout=30)
    assert pdf.status_code == 200
    assert "application/pdf" in (pdf.headers.get("content-type") or "")

    cgm_status_before = requests.get(f"{BASE_URL}/api/cgm/status", headers=_auth(tok), timeout=20)
    assert cgm_status_before.status_code == 200
    assert "configured" in cgm_status_before.json()

    cgm_save = requests.post(
        f"{BASE_URL}/api/cgm/settings",
        headers=_auth(tok),
        json={
            "source": "nightscout",
            "region": "global",
            "nightscout_url": "https://nonexistent-nightscout-iter11.invalid",
            "token": "",
            "username": "",
            "password": "",
            "patient_id": "",
        },
        timeout=20,
    )
    assert cgm_save.status_code == 200, cgm_save.text
    assert cgm_save.json()["configured"] is True
    assert cgm_save.json()["source"] == "nightscout"

    cgm_sync = requests.post(f"{BASE_URL}/api/cgm/sync", headers=_auth(tok), timeout=30)
    assert cgm_sync.status_code == 400


def test_account_deletion_revokes_sessions(disposable_identity):
    tok = disposable_identity["token"]
    deleted = requests.delete(
        f"{BASE_URL}/api/auth/account",
        headers=_auth(tok),
        json={"confirmation": "SUPPRIMER"},
        timeout=40,
    )
    assert deleted.status_code == 200, deleted.text

    me = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(tok), timeout=20)
    assert me.status_code == 401


# ---------------------------------------------------------------------------
# Module B — web_app.py local static serving behavior
# ---------------------------------------------------------------------------
@pytest.fixture
def local_web_client(tmp_path):
    web = tmp_path / "dist"
    web.mkdir()
    (web / "index.html").write_text("<html><body><h1>Index</h1></body></html>", encoding="utf-8")
    (web / "manifest.webmanifest").write_text('{"name":"TestPWA"}', encoding="utf-8")
    (web / "offline.html").write_text("<html><body>Offline</body></html>", encoding="utf-8")
    (web / "asset.js").write_text("console.log('ok');", encoding="utf-8")

    app = FastAPI()
    register_local_web(app, str(web))
    with TestClient(app) as client:
        yield client


def test_local_web_serves_index_manifest_and_headers(local_web_client):
    root = local_web_client.get("/")
    assert root.status_code == 200
    assert "no-store" in (root.headers.get("cache-control") or "")
    assert root.headers.get("x-content-type-options") == "nosniff"
    assert root.headers.get("referrer-policy") == "no-referrer"

    manifest = local_web_client.get("/manifest.webmanifest")
    assert manifest.status_code == 200
    assert "application/manifest+json" in (manifest.headers.get("content-type") or "")


def test_local_web_deeplink_fallback_and_api_404(local_web_client):
    profil = local_web_client.get("/profil")
    assert profil.status_code == 200
    assert "Index" in profil.text

    close_link = local_web_client.get("/proche/token-abc")
    assert close_link.status_code == 200

    api_route = local_web_client.get("/api/unknown")
    assert api_route.status_code == 404
    assert api_route.json().get("detail") == "Route API introuvable"


def test_local_web_blocks_traversal_dotfiles_and_missing_assets(local_web_client):
    traversal = local_web_client.get("/../server.py")
    assert traversal.status_code == 404

    dot_env = local_web_client.get("/.env")
    assert dot_env.status_code == 404

    missing_asset = local_web_client.get("/missing.css")
    assert missing_asset.status_code == 404


def test_exported_sw_has_strict_public_cache_only():
    sw = (ROOT / "frontend" / "dist" / "sw.js").read_text(encoding="utf-8")
    assert "PUBLIC_FILES = [\"/offline.html\", \"/pwa-icon.svg\", \"/manifest.webmanifest\"]" in sw
    assert "url.pathname === \"/api\" || url.pathname.startsWith(\"/api/\")" in sw
    assert "request.mode === \"navigate\"" in sw
    forbidden = ["/auth", "/report/pdf", "_expo/static/js", "oauth", "session"]
    assert all(item not in sw for item in forbidden)


# ---------------------------------------------------------------------------
# Module C — source export archive privacy/inclusion checks
# ---------------------------------------------------------------------------
def test_source_export_archive_excludes_env_data_and_secrets_bytes():
    proc = subprocess.run(["python", "scripts/export_source.py"], cwd=ROOT, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr or proc.stdout

    archive_path = ROOT / "dist" / "glycosoin-source.zip"
    assert archive_path.is_file()

    with ZipFile(archive_path, "r") as zf:
        names = zf.namelist()
        assert any(n.startswith("glycosoin/frontend/app/") for n in names)
        assert any(n.startswith("glycosoin/backend/") for n in names)
        assert "glycosoin/backend/.env" not in names
        assert all("/.env" not in n or n.endswith(".env.example") for n in names)
        assert all("/memory/" not in n for n in names)
        assert all("/node_modules/" not in n for n in names)
        assert all("/dist/" not in n for n in names)
        assert all("/.git/" not in n for n in names)

        blob = b"".join(zf.read(n) for n in names if n.endswith((".py", ".ts", ".tsx", ".js", ".json", ".md", ".yml", ".yaml", ".txt")))

    secret_values = []
    for line in (Path(BACKEND_ENV).read_text(encoding="utf-8").splitlines()):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip().upper()
        # Keep only sensitive vars (avoid false positives like DB_NAME/EMAIL_FROM_NAME)
        if not any(tok in key for tok in ("KEY", "SECRET", "PASSWORD", "TOKEN")):
            continue
        value = value.strip().strip('"').strip("'")
        if value:
            secret_values.append(value.encode("utf-8"))

    # Compare bytes only, do not print secret contents.
    assert all(secret not in blob for secret in secret_values)


def test_installation_files_static_semantics():
    compose_path = ROOT / "installation" / "compose.yaml"
    dockerfile_path = ROOT / "installation" / "Dockerfile"
    caddy_path = ROOT / "installation" / "Caddyfile"
    start_sh = ROOT / "installation" / "start.sh"
    start_ps1 = ROOT / "installation" / "start.ps1"

    compose = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
    services = compose.get("services", {})
    assert set(("mongodb", "app", "gateway")).issubset(set(services.keys()))
    assert "ports" not in services["mongodb"]
    assert "MONGO_URL" in services["app"].get("environment", {})
    assert "${MONGO_USER}" in services["app"]["environment"]["MONGO_URL"]
    assert services["gateway"]["ports"]

    dockerfile = dockerfile_path.read_text(encoding="utf-8")
    assert "COPY --from=web /build/frontend/dist /opt/glycosoin/web" in dockerfile
    assert "WEB_DIST_DIR=/opt/glycosoin/web" in dockerfile
    assert "--workers 1" in dockerfile

    caddy = caddy_path.read_text(encoding="utf-8")
    assert "tls internal" in caddy
    assert "reverse_proxy app:{$API_PORT}" in caddy

    sh_text = start_sh.read_text(encoding="utf-8")
    assert "if [[ ! -f \"$HERE/.env\" ]]" in sh_text
    assert "--configure-only" in sh_text
    assert "docker compose --env-file \"$HERE/.env\" -f \"$HERE/compose.yaml\" up -d --build --wait --wait-timeout 180" in sh_text

    ps_text = start_ps1.read_text(encoding="utf-8")
    assert "if (-not (Test-Path $EnvFile))" in ps_text
    assert "$Template.Replace(\"CHANGE_ME\", $Password)" in ps_text
    assert "-ConfigureOnly" in ps_text