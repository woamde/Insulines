import logging
from fastapi import FastAPI, File, UploadFile, Query, HTTPException, status
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from gemini_service import analyser_photo_repas

# Configuration du logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Insuline Backend API",
    description="API de gestion et d'analyse des repas pour personnes diabétiques",
    version="1.0.0"
)

# Activation des CORS pour la communication avec l'application mobile Expo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False, # 👈 LA CORRECTION EST ICI (False au lieu de True)
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"status": "ok", "message": "API Insuline fonctionnelle"}


@app.post("/api/analyser_repas")
async def endpoint_analyser_repas(
    file: UploadFile = File(...),
    ratio_glucides: float = Query(10.0, description="Ratio personnalisé (g/U)")
):
    try:
        image_bytes = await file.read()
        return analyser_photo_repas(image_bytes, ratio_glucides)
    except Exception:
        logger.exception("Erreur lors du traitement de l'image")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Le service d'analyse IA est temporairement indisponible. Veuillez réessayer.",
        )


@app.get("/demo", response_class=HTMLResponse, include_in_schema=False)
async def page_demo():
    """Interface de test visuelle pour navigateurs web."""
    return """<!DOCTYPE html>
<html lang="fr" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Analyseur de Repas - GlycoSoin</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen flex flex-col items-center p-4 sm:p-8">
    <div class="w-full max-w-2xl bg-slate-800 rounded-2xl shadow-xl p-6 border border-slate-700">
        <h1 class="text-2xl font-bold text-center text-teal-400 mb-1">Analyseur de Repas IA</h1>
        <p class="text-xs text-center text-slate-400 mb-6">Assistant GlycoSoin T1D</p>

        <form id="uploadForm" class="space-y-4">
            <div class="border-2 border-dashed border-slate-600 rounded-xl p-6 text-center hover:border-teal-400 transition cursor-pointer relative bg-slate-800/50">
                <input type="file" id="imageInput" accept="image/*" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" required>
                <div id="previewContainer" class="hidden mb-2">
                    <img id="imagePreview" class="max-h-64 mx-auto rounded-lg shadow-md object-cover" alt="Aperçu du repas">
                </div>
                <div id="placeholderText">
                    <svg class="mx-auto h-12 w-12 text-slate-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                    </svg>
                    <p class="text-sm text-slate-300 font-medium">Déposez une photo de votre repas ou cliquez ici</p>
                </div>
            </div>

            <div class="flex items-center space-x-4">
                <div class="flex-1">
                    <label class="block text-xs font-semibold text-slate-400 mb-1">Ratio personnalisé (g / U)</label>
                    <input type="number" id="ratioInput" step="0.1" value="20" class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-400">
                </div>
                <button type="submit" id="submitBtn" class="mt-5 bg-teal-600 hover:bg-teal-500 text-white font-medium px-6 py-2 rounded-lg transition disabled:opacity-50">
                    Analyser
                </button>
            </div>
        </form>

        <div id="loading" class="hidden mt-6 text-center text-teal-400 py-4 font-medium animate-pulse">
            Analyse de l'image par l'IA en cours...
        </div>

        <div id="resultCard" class="hidden mt-6 bg-slate-900/80 rounded-xl p-5 border border-slate-700 space-y-4">
            <div>
                <span class="text-xs uppercase font-bold text-teal-400 tracking-wider">Ton repas</span>
                <h2 id="nomPlat" class="text-lg font-semibold text-white mt-1"></h2>
            </div>

            <div class="bg-teal-950/40 border border-teal-800/50 rounded-xl p-4 text-center">
                <span class="text-xs uppercase font-bold text-teal-400 tracking-wider">Dose d'insuline suggérée</span>
                <div class="text-3xl font-extrabold text-white mt-1"><span id="doseInsuline">0</span> <span class="text-teal-400 text-lg">U</span></div>
            </div>

            <div class="grid grid-cols-2 gap-4 text-center">
                <div class="bg-slate-800/80 p-3 rounded-lg border border-slate-700">
                    <span class="text-xs text-slate-400 block">Glucides</span>
                    <span id="glucidesTotaux" class="text-lg font-bold text-white">0 g</span>
                </div>
                <div class="bg-slate-800/80 p-3 rounded-lg border border-slate-700">
                    <span class="text-xs text-slate-400 block">Confiance</span>
                    <span id="confiance" class="text-lg font-bold text-teal-400">-</span>
                </div>
            </div>

            <p id="conseil" class="text-xs text-slate-300 bg-slate-800 p-3 rounded-lg border border-slate-700/50 leading-relaxed"></p>
        </div>
    </div>

    <script>
        const imageInput = document.getElementById('imageInput');
        const imagePreview = document.getElementById('imagePreview');
        const previewContainer = document.getElementById('previewContainer');
        const placeholderText = document.getElementById('placeholderText');
        const uploadForm = document.getElementById('uploadForm');
        const submitBtn = document.getElementById('submitBtn');
        const loading = document.getElementById('loading');
        const resultCard = document.getElementById('resultCard');

        imageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    imagePreview.src = e.target.result;
                    previewContainer.classList.remove('hidden');
                    placeholderText.classList.add('hidden');
                };
                reader.readAsDataURL(file);
            }
        });

        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const file = imageInput.files[0];
            const ratio = document.getElementById('ratioInput').value;
            if (!file) return;

            loading.classList.remove('hidden');
            resultCard.classList.add('hidden');
            submitBtn.disabled = true;

            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch(`/api/analyser_repas?ratio_glucides=${ratio}`, {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();

                if (response.ok) {
                    document.getElementById('nomPlat').textContent = data.nom_plat || 'Repas analysé';
                    document.getElementById('doseInsuline').textContent = data.dose_insuline_suggeree ?? '0';
                    document.getElementById('glucidesTotaux').textContent = (data.estimation_glucides_g || '0') + ' g';
                    document.getElementById('confiance').textContent = data.confiance || 'Élevée';
                    document.getElementById('conseil').textContent = data.conseil || '';
                    resultCard.classList.remove('hidden');
                } else {
                    alert('Erreur : ' + (data.detail || 'Erreur lors de l\'analyse'));
                }
            } catch (err) {
                alert('Erreur réseau ou serveur inaccessible.');
            } finally {
                loading.classList.add('hidden');
                submitBtn.disabled = false;
            }
        });
    </script>
</body>
</html>"""