import { Platform } from "react-native";

// iOS 26+ rend les onglets natifs (Liquid Glass) ; iOS plus ancien, Android
// et web utilisent l'onglet JS classique.
export const usesNativeTabs =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;
