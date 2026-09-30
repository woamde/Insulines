import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";

import { useAuth } from "@/src/auth";
import { makeStyles, useTheme } from "@/src/theme";
import { Card } from "@/src/components/ui";

const REMOVED = [
  ["pulse-outline", "Glycémies, repas, photos et doses d’insuline"],
  ["fitness-outline", "Poids, activités, profil et objectifs"],
  ["chatbubbles-outline", "Conversations et bilans de l’assistant IA"],
  ["link-outline", "Connexions CGM, rappels et liens de partage"],
] as const;

export default function DeleteAccount() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const { user, deleteAccount, signOut } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitted = useRef(false);
  const pending = user?.account_deletion_pending;
  // Native swipe is disabled by the stack; block Android back while erasing.
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => busy);
    return () => listener.remove();
  }, [busy]);

  const cancel = () => {
    if (busy) return;
    if (pending) void signOut();
    else if (router.canGoBack()) router.back();
    else router.replace("/profil");
  };
  const remove = async () => {
    if (!confirmed || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError("");
    try {
      await deleteAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible. Réessayez.");
    } finally {
      submitted.current = false;
      setBusy(false);
    }
  };

  return (
    <View testID="delete-account-screen" style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="delete-account-back-button" accessibilityRole="button" accessibilityLabel="Retour" disabled={busy} onPress={cancel} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text testID="delete-account-header" style={styles.headerTitle}>Gestion du compte</Text>
      </View>
      <ScrollView testID="delete-account-scroll" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.icon}><Ionicons name="trash-outline" size={28} color={colors.error} /></View>
        <Text testID="delete-account-title" style={styles.title}>Supprimer mon compte</Text>
        <Text testID="delete-account-warning" style={styles.body}>Cette action est définitive. Votre compte GlycoSoin et les données qui lui sont associées seront effacés, sans possibilité de restauration.</Text>
        <Text testID="delete-account-identity" style={styles.identity}>{user?.email}</Text>

        <Card testID="delete-account-data-card">
          <Text testID="delete-account-data-title" style={styles.sectionTitle}>Ce qui sera supprimé</Text>
          {REMOVED.map(([icon, label], i) => (
            <View key={icon} style={styles.row}>
              <Ionicons name={icon} size={20} color={colors.muted} />
              <Text testID={`delete-account-data-${i}`} style={styles.rowText}>{label}</Text>
            </View>
          ))}
          <Text testID="delete-account-sessions-notice" style={styles.hint}>Toutes vos sessions GlycoSoin seront révoquées. Vos proches ne pourront plus consulter vos liens.</Text>
        </Card>

        <View style={styles.note}>
          <Text testID="delete-account-export-notice" style={styles.body}>Avant de continuer, vous pouvez conserver un rapport PDF depuis Statistiques.</Text>
          <Text testID="delete-account-external-notice" style={styles.hint}>Vos comptes Google et LibreLinkUp ne sont pas supprimés. Les copies déjà exportées, envoyées par e-mail ou enregistrées par un proche restent chez leurs destinataires.</Text>
          {!pending && <Pressable testID="delete-account-export-button" accessibilityRole="button" disabled={busy} onPress={() => router.push("/(tabs)/stats")} style={styles.exportButton}>
            <Ionicons name="document-text-outline" size={18} color={colors.onBrandTertiary} />
            <Text testID="delete-account-export-label" style={styles.exportText}>Accéder à mon rapport PDF</Text>
          </Pressable>}
        </View>

        {pending && <Text testID="delete-account-pending-notice" accessibilityRole="alert" style={styles.error}>Une suppression a déjà été engagée. Confirmez à nouveau pour terminer l’effacement.</Text>}
        <Pressable testID="delete-account-confirm-checkbox" accessibilityRole="checkbox" accessibilityState={{ checked: confirmed, disabled: busy }} disabled={busy} onPress={() => setConfirmed(!confirmed)} style={({ pressed }) => [styles.confirm, pressed && styles.pressed]}>
          <Ionicons name={confirmed ? "checkbox" : "square-outline"} size={26} color={confirmed ? colors.brandPrimary : colors.muted} />
          <Text testID="delete-account-confirm-label" style={styles.rowText}>Je comprends que mes données seront définitivement effacées.</Text>
        </Pressable>
        {!!error && <Text testID="delete-account-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text>}
        {busy && <Text testID="delete-account-progress" accessibilityLiveRegion="polite" style={styles.hint}>Effacement en cours… Gardez l’application ouverte.</Text>}
        <Pressable testID="delete-account-submit-button" accessibilityRole="button" accessibilityState={{ disabled: !confirmed || busy, busy }} disabled={!confirmed || busy} onPress={remove} style={({ pressed }) => [styles.deleteButton, (!confirmed || busy) && styles.disabled, pressed && styles.pressed]}>
          {busy && <ActivityIndicator testID="delete-account-spinner" color={colors.onError} />}
          <Text testID="delete-account-submit-label" style={styles.deleteText}>{busy ? "Suppression en cours…" : "Supprimer définitivement"}</Text>
        </Pressable>
        <Pressable testID="delete-account-cancel-button" accessibilityRole="button" disabled={busy} onPress={cancel} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
          <Text testID="delete-account-cancel-label" style={styles.cancelText}>{pending ? "Se déconnecter" : "Annuler et conserver mon compte"}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 8 },
  back: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "500", color: colors.onSurface },
  content: { padding: 20, gap: 18, maxWidth: 620, width: "100%", alignSelf: "center" },
  icon: { width: 60, height: 60, borderRadius: 20, backgroundColor: `${colors.error}12`, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "600", color: colors.onSurface },
  body: { fontSize: 15, lineHeight: 22, color: colors.onSurfaceSecondary },
  identity: { color: colors.muted, fontSize: 14 },
  sectionTitle: { fontSize: 17, fontWeight: "600", color: colors.onSurface, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 },
  rowText: { flex: 1, fontSize: 15, lineHeight: 22, color: colors.onSurfaceSecondary },
  hint: { fontSize: 13, lineHeight: 20, color: colors.muted, marginTop: 8 },
  note: { padding: 16, backgroundColor: colors.surfaceTertiary, borderRadius: 16 },
  exportButton: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  exportText: { color: colors.onBrandTertiary, fontSize: 14, flexShrink: 1, fontWeight: "500" },
  confirm: { flexDirection: "row", gap: 12, alignItems: "center", minHeight: 56, paddingVertical: 8 },
  error: { color: colors.error, fontSize: 14, lineHeight: 21, padding: 14, borderRadius: 12, backgroundColor: `${colors.error}0D` },
  deleteButton: { backgroundColor: colors.error, borderRadius: 14, minHeight: 54, padding: 14, flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center" },
  deleteText: { color: colors.onError, fontSize: 16, fontWeight: "600", flexShrink: 1, textAlign: "center" },
  cancelButton: { minHeight: 48, padding: 12, alignItems: "center", justifyContent: "center" },
  cancelText: { color: colors.onSurfaceSecondary, fontSize: 15, textAlign: "center" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
}));