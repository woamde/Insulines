from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer(auto_error=False)

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    # Mode dev : si un vrai jeton est présent, on l'utilise
    if credentials and credentials.credentials and credentials.credentials not in ["undefined", "null", ""]:
        return {"id": "user_1", "token": credentials.credentials}
    
    # Sinon (jeton absent, invalide ou "undefined"), on bascule sur l'utilisateur par défaut
    return {
        "id": "dev_user_1",
        "username": "Patient",
        "email": "patient@example.com"
    }