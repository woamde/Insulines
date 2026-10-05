// src/utils/router.ts
import { router as expoRouter } from "expo-router";

/**
 * Version sécurisée de l'objet router d'Expo.
 * Empêche l'erreur "GO_BACK not handled" en vérifiant l'historique.
 */
const safeRouter = {
  ...expoRouter,
  back: () => {
    if (expoRouter.canGoBack()) {
      expoRouter.back();
    } else {
      expoRouter.replace("/(tabs)");
    }
  },
};

export { safeRouter as router };