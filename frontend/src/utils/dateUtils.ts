export const formatHeureLocale = (isoString: string) => {
  if (!isoString) return '';
  
  let cleanString = isoString;
  if (!cleanString.endsWith('Z') && !cleanString.includes('+') && !cleanString.includes('-', 10)) {
    cleanString = `${cleanString}Z`;
  }

  const date = new Date(cleanString);

  // Utilisation des méthodes locales (getHours / getMinutes) pour s'adapter au fuseau horaire de l'appareil
  const heures = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${heures}:${minutes}`;
};