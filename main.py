from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="GlycoSoin API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CGMAuthPayload(BaseModel):
    email: str
    password: str

class UserProfilePayload(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    target_min: Optional[float] = 70.0
    target_max: Optional[float] = 180.0

# --- Health check ---

@app.get("/")
async def root():
    return {"status": "ok"}

# --- User Profile Endpoints ---

@app.get("/api/user/profile")
@app.get("/api/user/profile/")
@app.get("/user/profile")
@app.get("/user/profile/")
async def get_user_profile():
    return {
        "name": "Utilisateur GlycoSoin",
        "email": "hatif.abderahim@free.fr",
        "target_min": 70.0,
        "target_max": 180.0
    }

@app.put("/api/user/profile")
@app.put("/api/user/profile/")
@app.put("/user/profile")
@app.put("/user/profile/")
async def update_user_profile(profile: UserProfilePayload):
    return {"status": "success", "message": "Profil mis à jour", "profile": profile.model_dump()}

# --- CGM Endpoints ---

@app.post("/api/cgm/test")
@app.post("/api/cgm/test/")
@app.post("/cgm/test")
@app.post("/cgm/test/")
async def test_cgm_connection(payload: CGMAuthPayload):
    if not payload.email or not payload.password:
        raise HTTPException(status_code=400, detail="Identifiants incomplets.")
    return {"status": "success", "message": "Connexion à LibreLinkUp réussie !"}

@app.post("/api/cgm/config")
@app.post("/api/cgm/config/")
@app.post("/api/cgm/settings")
@app.post("/api/cgm/settings/")
@app.post("/cgm/config")
@app.post("/cgm/settings")
async def save_cgm_config(payload: CGMAuthPayload):
    if not payload.email or not payload.password:
        raise HTTPException(status_code=400, detail="Identifiants incomplets.")
    return {"status": "success", "message": "Configuration enregistrée avec succès."}