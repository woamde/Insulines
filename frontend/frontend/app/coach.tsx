import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { useAiModels, useCoach, type CoachReport } from "@/src/api";
import { Card, Chip, ChipRow, PrimaryButton } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";

const PERIODS = [7, 14, 30, 90];

const SECTIONS: { key: keyof CoachReport["report"]; title: string; icon: string }[] = [
  { key: "patterns", title: "Tendances observées", icon: "analytics-outline" },
  { key: "insulin", title: "Organisation de l'insuline", icon: "medkit-outline" },
  { key: "food", title: "Alimentation", icon: "restaurant-outline" },
  { key: "activity", title: "Activité physique", icon: "fitness-outline" },
  { key: "doctor_questions", title: "À aborder avec mon diabétologue", icon: "chatbubbles-outline" },
];

export default function Coach() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const models = useAiModels();
  const coach = useCoach();
  const [days, setDays] = useState(14);
  const [model, setModel] = useState<string | null>(null);
  const selected = model ?? models.data?.default ?? "claude-sonnet-4-6";

  const run = () => {
    coach.mutate({ days, model: selected }, { onError: (e) => toast.show(e.message, "error") });
  };

  const report = coach.data?.report;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} testID="coach-back-button" accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Coach IA</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
        <Card style={styles.introCard}>
          <Ionicons name="sparkles" size={20} color={colors.onBrandTertiary} />
          <Text style={styles.introText}>
            Plusieurs IA (Claude, GPT, Gemini) croisent vos glycémies, votre insuline, vos repas et votre sport pour proposer des pistes
            concrètes — sans jamais fixer de dose : ces observations se discutent avec votre diabétologue.
          </Text>
        </Card>

        <Card testID="coach-settings-card">
          <Text style={styles.label}>Période analysée</Text>
          <ChipRow>
            {PERIODS.map((d) => (
              <Chip key={d} label={`${d} j`} selected={days === d} onPress={() => setDays(d)} testID={`coach-period-${d}`} />
            ))}
          </ChipRow>
          <Text style={[styles.label, { marginTop: 12 }]}>Intelligence artificielle</Text>
          <ChipRow>
            {(models.data?.models ?? []).map((m) => (
              <Chip key={m.key} label={`${m.provider} · ${m.label}`} selected={selected === m.key} onPress={() => setModel(m.key)} testID={`coach-model-${m.key}`} />
            ))}
          </ChipRow>
          <View style={{ height: 12 }} />
          <PrimaryButton
            label={coach.isPending ? "Analyse en cours…" : "Analyser mes données"}
            onPress={run}
            loading={coach.isPending}
            icon={<Ionicons name="sparkles-outline" size={18} color={colors.onBrandPrimary} />}
            testID="coach-run-button"
          />
        </Card>

        {report ? (
          <View testID="coach-report">
            {report.alert ? (
              <View style={styles.alertBox} testID="coach-alert">
                <Ionicons name="warning" size={18} color={colors.error} />
                <Text style={styles.alertText}>{report.alert}</Text>
              </View>
            ) : null}
            <Card style={{ marginTop: 12 }} testID="coach-overview">
              <Text style={styles.overview}>{report.overview}</Text>
              <Text style={styles.meta}>
                {coach.data?.model_label} · {coach.data?.days} jours
              </Text>
            </Card>
            {SECTIONS.map((s) => {
              const items = report[s.key] as string[];
              if (!items || items.length === 0) return null;
              return (
                <Card key={s.key} style={{ marginTop: 12 }} testID={`coach-section-${s.key}`}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name={s.icon as never} size={18} color={colors.brandPrimary} />
                    <Text style={styles.sectionTitle}>{s.title}</Text>
                  </View>
                  {items.map((item, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <View style={styles.bullet} />
                      <Text style={styles.bulletText}>{item}</Text>
                    </View>
                  ))}
                </Card>
              );
            })}
            <Text style={styles.disclaimer}>
              Informations éducatives générées par IA à partir de vos données : elles ne remplacent pas l&apos;avis de votre équipe médicale et ne constituent pas une prescription.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 8 },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "500" },
  introCard: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: colors.brandTertiary, borderColor: colors.brandTertiary },
  introText: { flex: 1, color: colors.onBrandTertiary, fontSize: 13, lineHeight: 18 },
  label: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "500", marginBottom: 8 },
  alertBox: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: `${colors.error}14`, borderRadius: 12, padding: 12, marginTop: 12 },
  alertText: { flex: 1, color: colors.error, fontSize: 13, fontWeight: "500", lineHeight: 18 },
  overview: { color: colors.onSurface, fontSize: 15, lineHeight: 22 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 8 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  sectionTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "500" },
  bulletRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginBottom: 8 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brandPrimary, marginTop: 7 },
  bulletText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  disclaimer: { color: colors.muted, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 16 },
}));
