const API_URL = "https://insuline-backend.onrender.com/api/analyser_repas";

async function lireJsonSecurise(response) {
  const texte = await response.text();
  try {
    return JSON.parse(texte);
  } catch {
    // Le corps n'est pas du JSON valide (page d'erreur, réponse vide, timeout de proxy...).
    // On ne plante plus ici : on renvoie null et l'appelant décide du message à afficher.
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
      // Pas de Content-Type ici : fetch le fixe lui-même avec le boundary correct
      // pour un FormData. Le fixer à la main casse l'envoi du fichier.
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
