import io
from PIL import Image
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

class RepasAnalyse(BaseModel):
    nom_plat: str = Field(description="Nom ou description du repas identifié")
    estimation_glucides_g: float = Field(description="Estimation totale des glucides en grammes")
    conseil_insuline: str = Field(description="Recommandation générale ou note d'attention pour l'insuline")
    niveau_confiance: str = Field(description="Élevé, Moyen ou Faible")
    dose_insuline_suggeree_u: float = Field(default=0.0, description="Dose d'insuline calculée en Unités (U)")

client = genai.Client()

def analyser_photo_repas(image_bytes: bytes, ratio_glucides: float = 10.0) -> RepasAnalyse:
    image = Image.open(io.BytesIO(image_bytes))
    
    prompt = (
        "Analyse cette photo de repas pour un patient diabétique. "
        "Identifie les aliments, estime la quantité totale de glucides "
        "et donne une note explicative."
    )

    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=[image, prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=RepasAnalyse,
        ),
    )
    
    resultat: RepasAnalyse = response.parsed
    
    if ratio_glucides > 0:
        resultat.dose_insuline_suggeree_u = round(resultat.estimation_glucides_g / ratio_glucides, 1)
        
    return resultat