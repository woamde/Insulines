import { useState } from "react";
import { Platform, Text, View, TouchableOpacity } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { makeStyles, useTheme } from "@/src/theme";
import * as ApiModule from "@/src/api";
import * as UIModule from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";

// --- SÉCURISATION DES IMPORTS (Fallbacks anti-crash) ---
const Card = (UIModule as any).Card || (({ children, style }: any) => <View style={style}>{children}</View>);
const Chip = (UIModule as any).Chip || (({ label, onPress }: any) => <TouchableOpacity onPress={onPress}><Text>{label}</Text></TouchableOpacity>);
const ChipRow = (UIModule as any).ChipRow || (({ children }: any) => <View style={{ flexDirection: "row", gap: 8 }}>{children}</View>);
const PrimaryButton = (UIModule as any).PrimaryButton || (({ label, onPress, loading }: any) => (
  <TouchableOpacity onPress={onPress}><Text>{loading ? "Chargement..." : label}</Text></TouchableOpacity>
));

const reportUrl = (ApiModule as any).reportUrl || ((days: number) => `/api/report?days=${days}`);
const reportAuthHeaders = (ApiModule as any).reportAuthHeaders || (async () => ({}));
const useProfile = (ApiModule as any).useProfile || (() => ({ data: null }));
const useSendReportEmail = (ApiModule as any).useSendReportEmail || (() => ({
  mutate: (_days: number, options?: { onSuccess?: (d: any) => void; onError?: (e: any) => void }) => {
    options?.onError?.(new Error("L'envoi par e-mail n'est pas configuré."));
  },
  isPending: false,
}));
// --------------------------------------------------------

const PERIODS = [
  { days: 14, label: "14 jours" },
  { days: 30, label: "30 jours" },
  { days: 90, label: "90 jours" },
];

async function downloadReport(days: number): Promise<void> {
  const url = reportUrl(days);
  const headers = await reportAuthHeaders();
  const filename = `glycosoin-rapport-${days}j.pdf`;

  if (Platform.OS === "web") {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(res.status === 401 ? "Votre session a expiré : reconnectez-vous avec Google" : "Impossible de générer le rapport");
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return;
  }

  const destination = new File(Paths.cache, filename);
  const file = await File.downloadFileAsync(url, destination, { idempotent: true, headers: { ...headers, Accept: "application/pdf" } });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Le partage n'est pas disponible sur cet appareil");
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: "Envoyer le rapport à mon diabétologue",
  });
}

export function DoctorReport() {
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const profile = useProfile();
  const sendEmail = useSendReportEmail();
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const doctorEmail = profile.data?.doctor_email ?? "";

  const generate = async () => {
    setBusy(true);
    try {
      await downloadReport(days);
      toast.show("Rapport PDF prêt", "success");
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Impossible de générer le rapport", "error");
    } finally {
      setBusy(false);
    }
  };

  const emailDoctor = () => {
    if (!doctorEmail) {
      toast.show("Renseignez l'e-mail de votre diabétologue dans votre profil", "error");
      router.push("/profil" as any);
      return;
    }
    sendEmail.mutate(days, {
      onSuccess: (d: any) => toast.show(`Rapport envoyé à ${d?.to || doctorEmail}`, "success"),
      onError: (e: any) => toast.show(e?.message || "Erreur lors de l'envoi", "error"),
    });
  };

  return (
    <Card testID="doctor-report-card" style={{ marginTop: 12 }}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="document-text" size={18} color={colors.onBrandTertiary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Rapport pour mon médecin</Text>
          <Text style={styles.subtitle}>PDF clair : glycémies, TIR, HbA1c estimée, insuline, poids</Text>
        </View>
      </View>
      <ChipRow>
        {PERIODS.map((p) => (
          <Chip key={p.days} label={p.label} selected={days === p.days} onPress={() => setDays(p.days)} testID={`report-period-${p.days}`} />
        ))}
      </ChipRow>
      <View style={{ height: 12 }} />
      <PrimaryButton
        label={Platform.OS === "web" ? "Télécharger le PDF" : "Générer et partager le PDF"}
        onPress={generate}
        loading={busy}
        icon={<Ionicons name="share-outline" size={18} color={colors.onBrandPrimary} />}
        testID="generate-report-button"
      />
      <View style={{ height: 8 }} />
      <PrimaryButton
        label={doctorEmail ? `Envoyer à ${profile.data?.doctor_name || doctorEmail}` : "Envoyer à mon diabétologue"}
        onPress={emailDoctor}
        loading={sendEmail.isPending}
        variant="secondary"
        icon={<Ionicons name="mail-outline" size={18} color={colors.onBrandTertiary} />}
        testID="email-report-button"
      />
      {!doctorEmail ? <Text style={styles.hint}>Ajoutez l&apos;e-mail de votre médecin dans votre profil pour l&apos;envoi direct.</Text> : null}
    </Card>
  );
}

const useStyles = makeStyles((colors) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 8,
    lineHeight: 17,
  },
}));