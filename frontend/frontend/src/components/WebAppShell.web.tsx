import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function useInstallation() {
  const deferred = useRef<InstallEvent | null>(null);
  const [available, setAvailable] = useState(false);
  const [installed, setInstalled] = useState(() => typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [status, setStatus] = useState(Constants.expoConfig?.extra?.pwaEnabled ? "starting" : "preview");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      deferred.current = event as InstallEvent;
      setAvailable(true);
    };
    const onInstalled = () => { deferred.current = null; setAvailable(false); setInstalled(true); };
    const onNetwork = () => setOnline(navigator.onLine);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);
    if (Constants.expoConfig?.extra?.pwaEnabled) {
      Promise.resolve().then(async () => {
        if (!window.isSecureContext || !("serviceWorker" in navigator)) return "unavailable";
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        return "ready";
      }).then((next) => { if (active) setStatus(next); }).catch(() => { if (active) setStatus("failed"); });
    }
    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
    };
  }, []);

  const install = async () => {
    const event = deferred.current;
    if (!event || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await event.prompt();
      const result = await event.userChoice;
      setMessage(result.outcome === "dismissed" ? "Installation annulée. Vous pouvez continuer dans le navigateur." : "Demande acceptée. Le navigateur termine l’installation.");
    } catch {
      setMessage("Le navigateur n’a pas ouvert l’installation. Utilisez son menu Applications ou Installer.");
    } finally {
      deferred.current = null;
      setAvailable(false);
      setBusy(false);
    }
  };
  return { available, installed, online, status, message, busy, install };
}

export function WebAppShell({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [help, setHelp] = useState(false);
  const install = useInstallation();
  return (
    <View style={styles.outer}>
      <View testID="web-app-shell" style={styles.frame}>
        <View style={[styles.toolbar, { paddingTop: Math.max(8, insets.top) }]}>
          <View style={styles.brand}><Ionicons name="pulse" size={20} color={colors.brandPrimary} /><Text testID="web-app-brand" style={styles.brandText}>GlycoSoin</Text></View>
          <Pressable testID="web-install-help-button" accessibilityRole="button" onPress={() => setHelp(true)} style={({ pressed }) => [styles.helpButton, pressed && styles.pressed]}>
            <Ionicons name={install.installed ? "checkmark-circle-outline" : "download-outline"} size={18} color={colors.onBrandTertiary} />
            <Text testID="web-install-status" style={styles.helpText}>{install.installed ? "Installée" : "Installer l’application"}</Text>
          </Pressable>
        </View>
        {!install.online && <View testID="web-offline-banner" style={styles.offline}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.onSurface} />
          <Text testID="web-offline-message" accessibilityLiveRegion="polite" style={styles.offlineText}>Hors connexion : les informations affichées peuvent être anciennes. Aucune nouvelle saisie ne peut être enregistrée.</Text>
        </View>}
        <View style={styles.app}>{children}</View>
      </View>
      <Modal testID="web-install-modal" visible={help} transparent animationType="fade" onRequestClose={() => setHelp(false)}>
        <View style={[styles.backdrop, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.dialog} accessibilityViewIsModal>
            <ScrollView testID="web-install-help-scroll" contentContainerStyle={styles.instructions}>
              <View style={styles.dialogHeader}>
                <Ionicons name="desktop-outline" size={28} color={colors.brandPrimary} />
                <Pressable testID="web-install-close-button" accessibilityRole="button" accessibilityLabel="Fermer l’aide" onPress={() => setHelp(false)} style={styles.close}>
                  <Ionicons name="close" size={24} color={colors.onSurface} />
                </Pressable>
              </View>
              <Text testID="web-install-title" style={styles.title}>GlycoSoin sur votre ordinateur</Text>
              <Text testID="web-install-description" style={styles.body}>Une fenêtre dédiée, accessible depuis votre bureau, avec le même compte et les mêmes données que dans le navigateur.</Text>
              {install.installed ? <Text testID="web-installed-notice" style={styles.notice}>L’application est ouverte en mode installé.</Text> : null}
              {install.available && <Pressable testID="web-install-confirm-button" accessibilityRole="button" disabled={install.busy} onPress={install.install} style={({ pressed }) => [styles.installButton, pressed && styles.pressed]}>
                <Text testID="web-install-confirm-label" style={styles.installText}>{install.busy ? "Ouverture…" : "Installer GlycoSoin"}</Text>
              </Pressable>}
              <Text testID="web-install-windows-title" style={styles.heading}>Windows 11</Text>
              <Text testID="web-install-windows-instructions" style={styles.body}>Ouvrez l’application dans Edge ou Chrome. Utilisez l’icône d’installation dans la barre d’adresse ou le menu « Applications / Installer ce site en tant qu’application ». Le libellé dépend de votre navigateur.</Text>
              <Text testID="web-install-ubuntu-title" style={styles.heading}>Ubuntu</Text>
              <Text testID="web-install-ubuntu-instructions" style={styles.body}>Utilisez Chrome ou Chromium, puis l’option « Installer » du navigateur. Vous pourrez ouvrir GlycoSoin depuis le menu des applications.</Text>
              {install.status === "preview" && <Text testID="web-install-preview-notice" style={styles.notice}>Cet aperçu sert aux essais. Pour l’installation locale complète, utilisez les fichiers du dossier installation et le guide INSTALLATION_LOCALE.md.</Text>}
              {install.status === "unavailable" && <Text testID="web-install-https-notice" style={styles.notice}>L’installation nécessite HTTPS avec un certificat reconnu, ou localhost sur l’ordinateur hébergeant le serveur.</Text>}
              {install.status === "failed" && <Text testID="web-install-error" accessibilityRole="alert" style={styles.notice}>La préparation de l’installation a échoué. Vérifiez la connexion au serveur et rechargez la page.</Text>}
              {!!install.message && <Text testID="web-install-result" accessibilityLiveRegion="polite" style={styles.notice}>{install.message}</Text>}
              <Text testID="web-install-limits" style={styles.footnote}>La VM doit rester allumée et accessible. Google, les capteurs connectés, l’IA et les e-mails dépendent d’Internet. Les rappels natifs ne sont pas disponibles dans cette version web. Vos données médicales ne sont pas mises en cache hors connexion.</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  outer: { flex: 1, backgroundColor: colors.surfaceTertiary },
  frame: { flex: 1, width: "100%", maxWidth: 1100, alignSelf: "center", backgroundColor: colors.surface },
  app: { flex: 1, minHeight: 0 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceSecondary },
  brand: { flexDirection: "row", gap: 8, alignItems: "center" },
  brandText: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  helpButton: { flexDirection: "row", gap: 6, alignItems: "center", minHeight: 44, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.brandTertiary, flexShrink: 1 },
  helpText: { fontSize: 13, color: colors.onBrandTertiary, flexShrink: 1 },
  offline: { padding: 12, flexDirection: "row", gap: 10, backgroundColor: `${colors.warning}25` },
  offlineText: { flex: 1, color: colors.onSurface, fontSize: 13, lineHeight: 18 },
  backdrop: { flex: 1, padding: 20, backgroundColor: `${colors.surfaceInverse}88`, justifyContent: "center", alignItems: "center" },
  dialog: { maxWidth: 540, maxHeight: "100%", width: "100%", backgroundColor: colors.surfaceSecondary, borderRadius: 24, overflow: "hidden" },
  instructions: { padding: 24, gap: 14 },
  dialogHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, lineHeight: 32, fontWeight: "600", color: colors.onSurface },
  heading: { fontSize: 18, fontWeight: "600", color: colors.onSurface, marginTop: 6 },
  body: { fontSize: 15, lineHeight: 22, color: colors.onSurfaceSecondary },
  notice: { backgroundColor: colors.brandTertiary, padding: 14, borderRadius: 12, fontSize: 14, lineHeight: 20, color: colors.onBrandTertiary },
  footnote: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  installButton: { minHeight: 50, alignItems: "center", justifyContent: "center", padding: 14, borderRadius: 14, backgroundColor: colors.brandPrimary },
  installText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "600" },
  pressed: { opacity: 0.8 },
}));