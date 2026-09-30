import base64
import json
import logging
import os
from pydantic import BaseModel, Field
from litellm import completion
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


class RepasAnalyse(BaseModel):
    nom_plat: str = Field(description="Nom ou description du repas identifié")
    estimation_glucides_g: float = Field(description="Estimation totale des glucides en grammes")
    conseil_insuline: str = Field(description="Recommandation générale ou note d'attention pour l'insuline")
    niveau_confiance: str = Field(description="Élevé, Moyen ou Faible")
    dose_insuline_suggeree_u: float = Field(default=0.0, description="Dose d'insuline calculée en Unités (U)")


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=3),
    reraise=True
)
def _generer_analyse_gemini(image_bytes: bytes) -> RepasAnalyse:
    b64_image = base64.b64encode(image_bytes).decode("utf-8")

    prompt = (
        "Analyse cette photo de repas pour un patient diabétique. "
        "Identifie les aliments, estime la quantité totale de glucides en grammes et donne une note explicative. "
        "Retourne un objet JSON valide contenant exactement ces champs :\n"
        "- nom_plat (string)\n"
        "- estimation_glucides_g (number)\n"
        "- conseil_insuline (string)\n"
        "- niveau_confiance ('Élevé', 'Moyen' ou 'Faible')"
    )

    response = completion(
        model="gemini/gemini-1.5-flash",
        api_key=os.getenv("GEMINI_API_KEY"),
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64_image}"}
                    }
                ]
            }
        ],
        response_format={"type": "json_object"}
    )

    data = json.loads(response.choices[0].message.content)
    return RepasAnalyse(**data)


def _generer_analyse_gpt4o(image_bytes: bytes) -> RepasAnalyse:
    b64_image = base64.b64encode(image_bytes).decode("utf-8")

    prompt = (
        "Analyse cette photo de repas pour un patient diabétique. "
        "Identifie les aliments, estime la quantité totale de glucides en grammes et donne une note explicative. "
        "Retourne un objet JSON valide contenant exactement ces champs :\n"
        "- nom_plat (string)\n"
        "- estimation_glucides_g (number)\n"
        "- conseil_insuline (string)\n"
        "- niveau_confiance ('Élevé', 'Moyen' ou 'Faible')"
    )

    response = completion(
        model="gpt-4o",
        api_key=os.getenv("OPENAI_API_KEY"),
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64_image}"}
                    }
                ]
            }
        ],
        response_format={"type": "json_object"}
    )

    data = json.loads(response.choices[0].message.content)
    return RepasAnalyse(**data)


def analyser_photo_repas(image_bytes: bytes, ratio_glucides: float = 10.0) -> RepasAnalyse:
    # 1. Tentative d'analyse avec Gemini via LiteLLM
    try:
        resultat = _generer_analyse_gemini(image_bytes)
    except Exception as err:
        logger.warning("Échec Gemini (%s) — Bascule automatique sur GPT-4o", err)
        resultat = _generer_analyse_gpt4o(image_bytes)

    # 2. Recalcul de la dose d'insuline côté Python
    if ratio_glucides > 0 and resultat.estimation_glucides_g:
        resultat.dose_insuline_suggeree_u = round(
            resultat.estimation_glucides_g / ratio_glucides, 1
        )

    return resultat