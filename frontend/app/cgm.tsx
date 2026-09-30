import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { useCgmStatus, useCgmSync, useDisconnectCgm, useSaveCgmSettings, useTestCgmSettings } from "@/src/api";
import { relTime } from "@/src/glucose";
import { Card, Chip, ChipRow, PrimaryButton, TextField } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";

type IonName = React.ComponentProps<typeof Ionicons>["name"];

const SOURCES: {
  key: "dexcom" | "libre" | "nightscout";
  label: string;
  description: string;
  icon: IonName;
  regions: { key: string; label: string }[];
  usernameLabel: string;
  help: string;
}[] = [
  {
    key: "dexcom",
    label: "Dexcom",
    description: "G6 · G7 · One — via le partage Dexcom",
    icon: "bluetooth",
    regions: [
      { key: "us", label: "États-Unis" },
      { key: "ous", label: "International" },
    ],
    usernameLabel: "Identifiant Dexcom",
    help: "Connectez-vous avec le compte utilisé dans l'application Dexcom (le partage Dexcom doit être activé).",
  },
  {
    key: "libre",
    label: "FreeStyle Libre",
    description: "Libre 2 · 3 — via LibreLinkUp",
    icon: "pulse",
    regions: [
      { key: "eu", label: "Europe" },
      { key: "fr", label: "France" },
      { key: "us", label: "États-Unis" },
      { key: "global", label: "Autre" },
    ],
    usernameLabel: "E-mail LibreLinkUp",
    help: "Créez un compte LibreLinkUp, puis partagez vos mesures depuis l'app LibreLink vers ce compte (Inviter un proche).",
  },
  {
    key: "nightscout",
    label: "Nightscout",
    description: "Votre site Nightscout personnel",
    icon: "globe",
    regions: [],
    usernameLabel: "",
    help: "Renseignez l'URL de votre site Nightscout (ex : https://mon-site.example) et, si besoin, un token en lecture seule.",
  },
];

export default function Cgm() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();

  const status = useCgmStatus();
  const sync = useCgmSync();
  const save = useSaveCgmSettings();
  const disconnect = useDisconnectCgm();

  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState<"dexcom" | "libre" | "nightscout">("dexcom");
  const [region, setRegion] = useState("us");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nsUrl, setNsUrl] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    if (status.data?.configured && status.data.source) {
      setSource(status.data.source as "dexcom" | "libre" | "nightscout");
      if (status.data.region) setRegion(status.data.region);
    }
  }, [status.data?.configured, status.data?.source, status.data?.region]);

  const current = SOURCES.find((s) => s.key === source)!;
  const configured = status.data?.configured === true;
  const showForm = !configured || editing;

  const handleSync = () => {
    sync.mutate(undefined, {
      onSuccess: (d) => toast.show(`${d.inserted} mesure${d.inserted > 1 ? "s" : ""} récupérée${d.inserted > 1 ? "s" : ""}`, "success"),
      onError: (e) => toast.show(e.message, "error"),
    });
  };

  const test = useTestCgmSettings();
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [patients, setPatients] = useState<{ id: string; name: string }[]>([]);
  const [patientId, setPatientId] = useState("");

  const payload = () => ({ source, region, username: username.trim(), password, nightscout_url: nsUrl.trim(), token: token.trim(), patient_id: patientId });

  const testCredentials = () => {
    if (source !== "nightscout" && (!username.trim() || !password)) {
      toast.show("Renseignez vos identifiants", "error");
      return;
    }
    setTestResult(null);
    test.mutate(payload(), {
      onSuccess: (d) => {
        setTestResult({ ok: true, message: d.message });
        setPatients(d.patients ?? []);
        if (!patientId && d.selected_patient) setPatientId(d.selected_patient);
      },
      onError: (e) => setTestResult({ ok: false, message: e.message }),
    });
  };

  const connect = () => {
    if (source !== "nightscout" && (!username.trim() || !password.trim())) {
      toast.show("Renseignez vos identifiants", "error");
      return;
    }
    if (source === "nightscout" && !nsUrl.trim()) {
      toast.show("Renseignez l'URL de votre site Nightscout", "error");
      return;
    }
    save.mutate(
      payload(),
      {
        onSuccess: () => {
          toast.show("Capteur connecté", "success");
          setEditing(false);
          setPassword("");
          handleSync();
        },
        onError: (e) => toast.show(e.message, "error"),
      },
    );
  };

  const disconnectSensor = () => {
    disconnect.mutate(undefined, {
      onSuccess: () => toast.show("Capteur déconnecté", "success"),
      onError: (e) => toast.show(e.message, "error"),
    });
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} testID="cgm-back-button" accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Capteur en continu</Text>
      </View>

      {showForm ? (
        <KeyboardAwareScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionLabel}>Choisissez votre source</Text>
          {SOURCES.map((s) => (
            <Pressable
              key={s.key}
              style={[styles.sourceCard, source === s.key && styles.sourceCardSelected]}
              onPress={() => {
                setSource(s.key);
                setRegion(s.regions[0]?.key ?? "us");
              }}
              testID={`cgm-source-${s.key}`}
            >
              <View style={styles.sourceIcon}>
                <Ionicons name={s.icon} size={18} color={colors.onBrandTertiary} />
              </View>
              <View style={styles.sourceMain}>
                <Text style={styles.sourceLabel}>{s.label}</Text>
                <Text style={styles.sourceDesc}>{s.description}</Text>
              </View>
              {source === s.key ? <Ionicons name="checkmark-circle" size={22} color={colors.brandPrimary} /> : null}
            </Pressable>
          ))}

          <Card style={{ marginTop: 12 }}>
            {current.regions.length > 0 ? (
              <>
                <Text style={styles.cardTitle}>Région du compte</Text>
                <ChipRow>
                  {current.regions.map((r) => (
                    <Chip key={r.key} label={r.label} selected={region === r.key} onPress={() => setRegion(r.key)} testID={`cgm-region-${r.key}`} />
                  ))}
                </ChipRow>
              </>
            ) : null}
            {source === "nightscout" ? (
              <>
                <TextField label="URL du site" value={nsUrl} onChangeText={setNsUrl} placeholder="https://mon-site.example" testID="cgm-ns-url-input" />
                <TextField label="Token (optionnel)" value={token} onChangeText={setToken} placeholder="Token en lecture" testID="cgm-ns-token-input" />
              </>
            ) : (
              <>
                <TextField label={current.usernameLabel} value={username} onChangeText={setUsername} placeholder={source === "libre" ? "vous@exemple.fr" : "identifiant"} testID="cgm-username-input" />
                <TextField label="Mot de passe" value={password} onChangeText={setPassword} placeholder="••••••••" secure testID="cgm-password-input" />
              </>
            )}
            <Text style={styles.helpText}>{current.help}</Text>
          </Card>

          {source === "libre" ? (
            <Card style={{ marginTop: 12 }} testID="cgm-libre-guide">
              <Text style={styles.cardTitle}>Check-list FreeStyle Libre</Text>
              {[
                "Installez l'application LibreLinkUp (l'app « suiveur », différente de LibreLink) et créez-y un compte.",
                "Dans LibreLink (téléphone du patient) : Menu › Applications connectées › LibreLinkUp › Ajouter une connexion, avec l'e-mail du compte LibreLinkUp.",
                "Acceptez l'invitation et les conditions d'utilisation dans LibreLinkUp, puis vérifiez qu'une glycémie s'y affiche.",
                "Saisissez ici exactement l'e-mail et le mot de passe de ce compte LibreLinkUp (sans espace).",
              ].map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </Card>
          ) : null}

          {testResult ? (
            <View style={[styles.resultBox, { backgroundColor: testResult.ok ? `${colors.success}1A` : `${colors.error}14` }]} testID="cgm-test-result">
              <Ionicons name={testResult.ok ? "checkmark-circle" : "alert-circle"} size={18} color={testResult.ok ? colors.success : colors.error} />
              <Text style={[styles.resultText, { color: testResult.ok ? colors.success : colors.error }]}>{testResult.message}</Text>
            </View>
          ) : null}

          {patients.length > 1 ? (
            <Card style={{ marginTop: 8 }} testID="cgm-patient-card">
              <Text style={styles.cardTitle}>Quel patient suivre ?</Text>
              <ChipRow>
                {patients.map((p) => (
                  <Chip key={p.id} label={p.name} selected={patientId === p.id} onPress={() => setPatientId(p.id)} testID={`cgm-patient-${p.id}`} />
                ))}
              </ChipRow>
              <Text style={styles.helpText}>Votre compte LibreLinkUp suit plusieurs personnes : les mesures importées seront celles du patient sélectionné.</Text>
            </Card>
          ) : null}

          <PrimaryButton label="Tester les identifiants" onPress={testCredentials} loading={test.isPending} variant="secondary" testID="cgm-test-button" icon={<Ionicons name="flash-outline" size={18} color={colors.onBrandTertiary} />} />
          <View style={{ height: 8 }} />
          <PrimaryButton label="Connecter" onPress={connect} loading={save.isPending} testID="cgm-connect-button" />
          {configured ? (
            <Pressable onPress={() => setEditing(false)} style={styles.textButton} testID="cgm-edit-cancel-button">
              <Text style={styles.textButtonText}>Annuler</Text>
            </Pressable>
          ) : null}
        </KeyboardAwareScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
          <Card testID="cgm-status-detail-card">
            <View style={styles.statusRow}>
              <View style={styles.sourceIcon}>
                <Ionicons name={current.icon} size={18} color={colors.onBrandTertiary} />
              </View>
              <View style={styles.sourceMain}>
                <Text style={styles.sourceLabel}>{status.data?.source_label}</Text>
                <Text style={styles.sourceDesc}>
                  {status.data?.last_sync_at ? `Dernière synchro ${relTime(status.data.last_sync_at)}` : "Jamais synchronisé"}
                </Text>
              </View>
            </View>
            {status.data?.last_error ? (
              <View style={styles.errorBox} testID="cgm-last-error">
                <Ionicons name="alert-circle" size={18} color={colors.error} />
                <Text style={styles.errorText}>{status.data.last_error}</Text>
              </View>
            ) : null}
            <PrimaryButton label="Synchroniser maintenant" onPress={handleSync} loading={sync.isPending} testID="cgm-sync-now-button" />
            <Pressable onPress={() => setEditing(true)} style={styles.textButton} testID="cgm-edit-button">
              <Text style={styles.textButtonText}>Modifier les identifiants</Text>
            </Pressable>
            <Pressable onPress={disconnectSensor} style={styles.textButton} testID="cgm-disconnect-button">
              <Text style={[styles.textButtonText, { color: colors.error }]}>Déconnecter le capteur</Text>
            </Pressable>
          </Card>

          <Card style={{ marginTop: 12 }}>
            <Text style={styles.cardTitle}>Bon à savoir</Text>
            <Text style={styles.helpText}>
              Les données du capteur peuvent être retardées de quelques minutes et ne remplacent pas une piqûre au doigt :
              confirmez toujours avec une mesure capillaire avant une décision d&apos;insuline.
            </Text>
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  stepRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    marginBottom: 8,
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepBadgeText: {
    color: colors.onBrandTertiary,
    fontSize: 12,
    fontWeight: "500",
  },
  stepText: {
    flex: 1,
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  resultBox: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    marginBottom: 4,
  },
  resultText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: colors.onSurface,
    fontSize: 22,
    fontWeight: "500",
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 8,
  },
  sourceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  sourceCardSelected: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandTertiary,
  },
  sourceIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceMain: {
    flex: 1,
  },
  sourceLabel: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
  },
  sourceDesc: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  cardTitle: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 10,
  },
  helpText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: `${colors.error}1A`,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  textButton: {
    alignItems: "center",
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  textButtonText: {
    color: colors.onSurfaceSecondary,
    fontSize: 14,
    fontWeight: "500",
  },
}));
