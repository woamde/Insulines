const API_URL = "https://insuline-backend.onrender.com/api/analyser_repas";

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
      'Content-Type': 'multipart/form-data',
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || "Erreur lors de l'analyse");
  }

  return await response.json();
}