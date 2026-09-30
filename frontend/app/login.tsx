import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/components/Toast";

const FEATURES = [
  { icon: "water" as const, text: "Suivi de glycémie et graphiques de tendance" },
  { icon: "calculator" as const, text: "Calcul des glucides et du bolus d'insuline" },
  { icon: "sparkles" as const, text: "Assistant IA et analyse de photos de repas" },
  { icon: "bluetooth" as const, text: "Capteurs Dexcom, FreeStyle Libre, Nightscout" },
];

export default function Login() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const { signIn, signingIn, deletionNotice } = useAuth();
  const toast = useToast();

  const handleSignIn = async () => {
    const result = await signIn();
    if (result.status === "failed") {
      toast.show(result.error ? `Connexion Google refusée : ${result.error}` : "La connexion Google n'a pas abouti. Vérifiez votre connexion internet et réessayez.", "error");
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={[colors.brandTertiary, colors.surface]} style={styles.gradient} />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.logoWrap}>
          <View style={styles.logo}>
            <Ionicons name="pulse" size={38} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.appName}>GlycoSoin</Text>
          <Text style={styles.tagline}>Votre suivi du diabète de type 1, en toute simplicité</Text>
        </View>

        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.text} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon} size={18} color={colors.onBrandTertiary} />
              </View>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        <View style={styles.bottom}>
          {deletionNotice && <View testID="account-deleted-notice" style={styles.deletionNotice}>
            <Ionicons name="checkmark-circle-outline" size={22} color={colors.onBrandTertiary} />
            <Text testID="account-deleted-message" accessibilityLiveRegion="polite" style={styles.deletionText}>{deletionNotice}</Text>
          </View>}
          <Pressable
            style={({ pressed }) => [styles.googleButton, pressed && { opacity: 0.9 }]}
            onPress={handleSignIn}
            disabled={signingIn}
            testID="google-signin-button"
            accessibilityRole="button"
          >
            <Ionicons name="logo-google" size={20} color="#EA4335" />
            <Text style={styles.googleText}>{signingIn ? "Connexion…" : "Continuer avec Google"}</Text>
          </Pressable>
          <Text style={styles.disclaimer}>
            Application d&apos;aide au suivi. Les informations fournies ne remplacent pas un avis médical.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  deletionNotice: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.brandTertiary },
  deletionText: { flex: 1, color: colors.onBrandTertiary, fontSize: 14, lineHeight: 20 },
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  gradient: {
    ...{ position: "absolute", top: 0, left: 0, right: 0, height: 360 },
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },
  logoWrap: {
    alignItems: "center",
    gap: 12,
    marginTop: 24,
  },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 26,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  appName: {
    color: colors.onSurface,
    fontSize: 30,
    fontWeight: "500",
  },
  tagline: {
    color: colors.muted,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 21,
    paddingHorizontal: 16,
  },
  features: {
    gap: 16,
    marginVertical: 24,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    flex: 1,
    color: colors.onSurfaceSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  bottom: {
    gap: 16,
  },
  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.onSurface,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  googleText: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "500",
  },
  disclaimer: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
}));
