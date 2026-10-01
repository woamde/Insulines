import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import jwt

SECRET_KEY = os.getenv("SECRET_KEY", "glycosoin-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 jours

# auto_error=False évite de bloquer l'application si aucun token n'est transmis au démarrage
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/token", auto_error=False)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Génère un jeton JWT d'accès."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: Optional[str] = Depends(oauth2_scheme)) -> dict:
    """
    Dépendance FastAPI pour récupérer l'utilisateur courant.
    Retourne un profil par défaut si aucun token valide n'est fourni.
    """
    default_user = {
        "id": "user_patient_default",
        "username": "patient",
        "email": "patient@example.com",
        "first_name": "Patient"
    }

    if not token:
        return default_user

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub") or payload.get("id")
        if not user_id:
            return default_user
        return {
            "id": user_id,
            "username": payload.get("username", "patient"),
            "email": payload.get("email", "patient@example.com"),
            "first_name": payload.get("first_name", "Patient")
        }
    except Exception:
        return default_user