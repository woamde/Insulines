import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "GlycoSoin T1D",
  slug: config.slug ?? "frontend",
  extra: {
    ...config.extra,
    backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL ?? "",
    pwaEnabled: process.env.EXPO_PUBLIC_ENABLE_PWA === "1",
  },
});