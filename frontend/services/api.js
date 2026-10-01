import React, { useState } from 'react';
import { synchroniserCapteurCGM } from './api';

// À insérer dans ton composant (ex. Dashboard / Accueil)
const [loadingSync, setLoadingSync] = useState(false);

const handleSync = async () => {
  setLoadingSync(true);
  try {
    const data = await synchroniserCapteurCGM();
    
    // Notification de succès avec le nombre de mesures
    alert(`Synchronisation réussie ! ${data?.inserted || 0} nouvelle(s) mesure(s) importée(s).`);

    // Rafraîchit l'affichage des graphiques et données du tableau de bord
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  } catch (err) {
    alert(`Échec : ${err.message}`);
    console.error("Erreur synchronisation CGM :", err);
  } finally {
    setLoadingSync(false);
  }
};