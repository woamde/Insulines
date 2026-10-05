const API_URL = "https://insuline-backend.onrender.com/api/analyser_repas";
const BASE_URL = "http://localhost:8000/api";

async function lireJsonSecurise(response) {
  const texte = await response.text();
  try {
    return JSON.parse(texte);
  } catch {
    return null;
  }
}

export async function analyserRepasMobile(imageUri, ratioGlucides = 10.0) {
  const formData = new FormData();

  const filename = imageUri.split('/').pop();
  const match = /\.(\w+)$/.exec(filename);
  const type = match ? `image/${match[1]}` : `image/jpeg`;

  formData.append('file', {
    uri: imageUri,
    name: filename,
    type: type,
  });

  const response = await fetch(`${API_URL}?ratio_glucides=${ratioGlucides}`, {
    method: 'POST',
    body: formData,
    headers: {
      'Accept': 'application/json',
    },
  });

  const data = await lireJsonSecurise(response);

  if (!response.ok) {
    throw new Error(data?.detail || `Erreur lors de l'analyse (code ${response.status})`);
  }

  if (!data) {
    throw new Error("Réponse invalide du serveur d'analyse.");
  }

  return data;
}

export async function fetchProfile() {
  const response = await fetch(`${BASE_URL}/profile`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  const data = await lireJsonSecurise(response);

  if (!response.ok) {
    throw new Error(data?.detail || `Erreur lors de la récupération du profil (code ${response.status})`);
  }

  if (!data) {
    throw new Error("Données de profil vides reçues du serveur.");
  }

  // Retourne l'objet profil de manière sécurisée sans ternaire redondant
  return data.profile || data;
}

export async function saveProfile(profileData) {
  const response = await fetch(`${BASE_URL}/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(profileData),
  });

  const data = await lireJsonSecurise(response);

  if (!response.ok) {
    throw new Error(data?.detail || `Erreur lors de la mise à jour du profil (code ${response.status})`);
  }

  return data || {};
}