// src/utils/dateUtils.ts

export const formatHeureLocale = (isoString: string) => {
  if (!isoString) return '';
  
  // S'assure que la chaîne ISO possède bien le suffixe "Z" (UTC)
  const utcDateString = isoString.endsWith('Z') ? isoString : `${isoString}Z`;
  const date = new Date(utcDateString);

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false, // Format 24h
  });
};