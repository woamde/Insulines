import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user

logger = logging.getLogger(__name__)

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")

CLAUDE_SONNET = "claude-sonnet-4-6"
CLAUDE_HAIKU = "claude-haiku-4-5"
GPT_5_4 = "gpt-5.4"
GPT_5_4_MINI = "gpt-5.4-mini"
GEMINI_3_1_PRO = "gemini-3.1-pro"
GEMINI_3_FLASH = "gemini-3-flash"

TEXT_MODELS = {
    CLAUDE_SONNET: ("anthropic", "claude-sonnet-4-6"),
    CLAUDE_HAIKU: ("anthropic", "claude-haiku-4-5-20251001"),
    GPT_5_4: ("openai", "gpt-5.4"),
    GPT_5_4_MINI: ("openai", "gpt-5.4-mini"),
    GEMINI_3_1_PRO: ("gemini", "gemini-3.1-pro-preview"),
    GEMINI_3_FLASH: ("gemini", "gemini-3-flash-preview"),
}

MODEL_LABELS = {
    CLAUDE_SONNET: "Claude Sonnet 4.6 (conseils, nuance)",
    CLAUDE_HAIKU: "Claude Haiku 4.5 (rapide)",
    GPT_5_4: "GPT-5.4 (analyse approfondie)",
    GPT_5_4_MINI: "GPT-5.4 mini (rapide)",
    GEMINI_3_1_PRO: "Gemini 3.1 Pro (photos, données)",
    GEMINI_3_FLASH: "Gemini 3 Flash (rapide)",
}

SYSTEM_COACH = (
    "Tu es un coach diabète de type 1 (éducation thérapeutique), tu réponds en français. "
    "À partir des données chiffrées fournies, tu identifies des tendances et proposes des pistes concrètes "
    "d'amélioration. Tu ne fixes JAMAIS de dose d'insuline ni de ratio précis. "
    "Tu réponds STRICTEMENT en JSON valide, sans texte autour."
)
DEFAULT_TEXT_MODEL = os.environ.get("DEFAULT_LLM_MODEL", CLAUDE_SONNET)
SUMMARY_TEXT_MODEL = os.environ.get("SUMMARY_LLM_MODEL", DEFAULT_TEXT_MODEL)
VISION_MODEL = ("gemini", "gemini-3.1-pro-preview")

SYSTEM_ASSISTANT = (
    "Tu es un assistant spécialisé dans le diabète de type 1, tu réponds toujours en français. "
    "Sois clair, bienveillant et concis. Ne donne jamais de dose d'insuline précise."
)

_db = None

ERROR_RESPONSES = {
    400: {"description": "Bad Request"},
    502: {"description": "Bad Gateway"}
}

def init_ai(db):
    global _db
    _db = db

class ChatRequest(BaseModel):
    message: str
    model: str = DEFAULT_TEXT_MODEL

class AnalyzeMealRequest(BaseModel):
    image_base64: str

def _new_chat(session_id: str, system_message: str, model_key: str) -> LlmChat:
    provider, model_name = TEXT_MODELS.get(model_key, TEXT_MODELS[DEFAULT_TEXT_MODEL])
    return LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system_message).with_model(
        provider, model_name
    )

def _extract_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {}
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}

def _clean_image_base64(raw: str) -> str:
    if not raw:
        return ""
    if "," in raw and raw.strip().startswith("data:"):
        return raw.split(",", 1)[1]
    return raw

def _get_period_key(hour: int) -> str:
    if hour < 6:
        return "nuit (0-6h)"
    if hour < 11:
        return "matin (6-11h)"
    if hour < 15:
        return "midi (11-15h)"
    if hour < 19:
        return "après-midi (15-19h)"
    return "soirée (19-24h)"

def _build_period_stats(readings, tz, low_t, high_t) -> list:
    periods = {"nuit (0-6h)": [], "matin (6-11h)": [], "midi (11-15h)": [], "après-midi (15-19h)": [], "soirée (19-24h)": []}
    for r in readings:
        h = r["measured_at"].astimezone(tz).hour
        periods[_get_period_key(h)].append(r["value_mgdl"])
    
    lines = []
    for k, vals in periods.items():
        if vals:
            tir = sum(1 for v in vals if low_t <= v <= high_t) / len(vals) * 100
            lines.append(f"  - {k} : moyenne {sum(vals)/len(vals):.0f}, TIR {tir:.0f} %, hypos {sum(1 for v in vals if v < low_t)}, n={len(vals)}")
    return lines

def _build_meal_stats(meals, readings, tz) -> list:
    lines = []
    for m in sorted(meals, key=lambda x: x["eaten_at"])[-12:]:
        after = [r["value_mgdl"] for r in readings if m["eaten_at"] + timedelta(minutes=90) <= r["measured_at"] <= m["eaten_at"] + timedelta(minutes=150)]
        time_str = m['eaten_at'].astimezone(tz).strftime('%d/%m %H:%M')
        avg_after = f"{sum(after)/len(after):.0f}" if after else "?"
        lines.append(f"  - {time_str} {m.get('meal_type', 'repas')} « {m.get('name') or ''} » : {m.get('carbs_g', 0):.0f} g, bolus {m.get('insulin_units', 0)} U, avant {m.get('glucose_before', '?')} → 2 h après {avg_after}")
    return lines

async def _fetch_coach_data(uid, start):
    profile = await _db.profiles.find_one({"user_id": uid}, {"_id": 0}) or {}
    readings = await _db.glucose_readings.find({"user_id": uid, "deleted_at": None, "measured_at": {"$gte": start}}).sort("measured_at", 1).to_list(20000)
    meals = await _db.meals.find({"user_id": uid, "deleted_at": None, "eaten_at": {"$gte": start}}).to_list(3000)
    return profile, readings, meals

async def _generate_coach_report(uid: str, days: int, model: str) -> dict:
    start = datetime.now(timezone.utc) - timedelta(days=days)
    profile, readings, meals = await _fetch_coach_data(uid, start)
    if len(readings) < 5:
        raise HTTPException(status_code=400, detail="Pas assez de glycémies (5 minimum)")

    low_t, high_t = float(profile.get("target_low", 70)), float(profile.get("target_high", 180))
    tz = ZoneInfo("Europe/Paris")
    avg = sum(r["value_mgdl"] for r in readings) / len(readings)
    
    prompt = (
        f"PROFIL : {profile}\nGLYCÉMIES : moyenne {avg:.0f}\n"
        + "\n".join(_build_period_stats(readings, tz, low_t, high_t)) + "\n"
        + "\n".join(_build_meal_stats(meals, readings, tz))
    )
    chat = _new_chat(f"coach:{uid}:{datetime.now(timezone.utc).timestamp()}", SYSTEM_COACH, model)
    
    try:
        reply = await chat.send_message(UserMessage(text=prompt))
    except Exception:
        logger.exception("AI coach error")
        raise HTTPException(status_code=502, detail="Analyse IA indisponible")
        
    report = _extract_json(reply) or {"overview": reply[:1200]}
    doc = {
        "user_id": uid,
        "days": days,
        "model": model,
        "report": report,
        "created_at": datetime.now(timezone.utc),
    }
    await _db.ai_coach_reports.insert_one(doc)
    return {"days": days, "model": model, "report": report, "created_at": doc["created_at"].isoformat()}

def register_ai(api_router: APIRouter) -> None:
    @api_router.get("/ai/models")
    async def ai_models(user: dict = Depends(get_current_user)):
        return {
            "default": DEFAULT_TEXT_MODEL,
            "models": [
                {"key": CLAUDE_SONNET, "label": "Claude Sonnet 4.6", "provider": "Claude"},
                {"key": CLAUDE_HAIKU, "label": "Claude Haiku 4.5", "provider": "Claude"},
                {"key": GPT_5_4, "label": "GPT-5.4", "provider": "OpenAI"},
                {"key": GPT_5_4_MINI, "label": "GPT-5.4 mini", "provider": "OpenAI"},
                {"key": GEMINI_3_1_PRO, "label": "Gemini 3.1 Pro", "provider": "Gemini"},
                {"key": GEMINI_3_FLASH, "label": "Gemini 3 Flash", "provider": "Gemini"},
            ],
        }

    @api_router.get("/ai/messages")
    async def ai_messages(user: dict = Depends(get_current_user)):
        return await _db.ai_messages.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(200)

    @api_router.delete("/ai/messages")
    async def clear_ai_messages(user: dict = Depends(get_current_user)):
        await _db.ai_messages.delete_many({"user_id": user["user_id"]})
        return {"ok": True}

    @api_router.post("/ai/chat", responses=ERROR_RESPONSES)
    async def ai_chat(body: ChatRequest, user: dict = Depends(get_current_user)):
        message = body.message.strip()
        if not message or body.model not in TEXT_MODELS:
            raise HTTPException(status_code=400, detail="Requête invalide")

        uid = user["user_id"]
        now = datetime.now(timezone.utc)
        chat = _new_chat(f"assistant:{uid}", SYSTEM_ASSISTANT, body.model)
        
        try:
            reply = await chat.send_message(UserMessage(text=message))
        except Exception:
            logger.exception("AI chat error")
            raise HTTPException(status_code=502, detail="L'assistant IA est indisponible")

        await _db.ai_messages.insert_many([
            {"user_id": uid, "role": "user", "content": message, "created_at": now},
            {"user_id": uid, "role": "assistant", "content": reply, "created_at": now + timedelta(milliseconds=1)},
        ])
        return {"reply": reply}

    @api_router.post("/ai/analyze-meal", responses=ERROR_RESPONSES)
    async def analyze_meal(body: AnalyzeMealRequest, user: dict = Depends(get_current_user)):
        raw = _clean_image_base64(body.image_base64)
        if not raw:
            raise HTTPException(status_code=400, detail="Image manquante")

        provider, model_name = VISION_MODEL
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"vision:{user['user_id']}", system_message="Analyse photo repas").with_model(provider, model_name)
        
        try:
            reply = await chat.send_message(UserMessage(text="Estime les glucides en JSON", file_contents=[ImageContent(image_base64=raw)]))
        except Exception:
            logger.exception("AI vision error")
            raise HTTPException(status_code=502, detail="Analyse de la photo échouée")

        parsed = _extract_json(reply)
        return parsed if parsed else {"items": [], "total_carbs_g": 0, "confidence": "faible", "note": ""}

    @api_router.get("/ai/coach", responses=ERROR_RESPONSES)
    async def ai_coach(days: int = 14, model: str = DEFAULT_TEXT_MODEL, user: dict = Depends(get_current_user)):
        uid = user["user_id"]
        clamped_days = max(7, min(days, 90))
        return await _generate_coach_report(uid, clamped_days, model)

    @api_router.get("/ai/weekly-summary", responses=ERROR_RESPONSES)
    async def weekly_summary(user: dict = Depends(get_current_user)):
        uid = user["user_id"]
        start = datetime.now(timezone.utc) - timedelta(days=7)
        readings = await _db.glucose_readings.find({"user_id": uid, "deleted_at": None, "measured_at": {"$gte": start}}).to_list(5000)
        
        if len(readings) < 3:
            raise HTTPException(status_code=400, detail="Pas assez de mesures")

        values = [r["value_mgdl"] for r in readings]
        chat = _new_chat(f"summary:{uid}", SYSTEM_ASSISTANT, SUMMARY_TEXT_MODEL)
        
        try:
            reply = await chat.send_message(UserMessage(text=f"Fais un résumé pour {len(values)} mesures, moyenne {sum(values)/len(values):.1f}"))
        except Exception:
            logger.exception("AI summary error")
            raise HTTPException(status_code=502, detail="Bilan indisponible")

        return {"summary": reply}