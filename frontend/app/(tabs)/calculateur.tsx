import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View, ActivityIndicator, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useProfile } from "@/src/api";
import { round1 } from "@/src/glucose";
import { unitsFor } from "@/src/units";
import { makeStyles, useTheme } from "@/src/theme";

interface BolusParams {
  readonly carbs: number;
  readonly glucose: number | null;
  readonly icRatio: number;
  readonly isf: number;
  readonly targetGlucose: number;
}

interface BolusResult {
  readonly total: number;
  readonly carbsDose: number;
  readonly correctionDose: number;
}

function calculateBolus({
  carbs,
  glucose,
  icRatio,
  isf,
  targetGlucose,
}: BolusParams): BolusResult {
  const carbsDose = icRatio > 0 ? carbs / icRatio : 0;
  const correctionDose =
    glucose !== null && isf > 0 ? (glucose - targetGlucose) / isf : 0;
  const total = Math.max(0, carbsDose + correctionDose);

  return { total, carbsDose, correctionDose };
}

export default function CalculateurScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();

  const profile = useProfile();
  const units = unitsFor(profile.data?.glucose_unit);

  const [carbsInput, setCarbsInput] = useState("");
  const [glucoseInput, setGlucoseInput] = useState("");

  const carbs = Number.parseFloat(carbsInput.replace(",", ".")) || 0;
  const glucoseVal = Number.parseFloat(glucoseInput.replace(",", ".")) || null;

  const isMmol = profile.data?.glucose_unit === "mmol";

  const glucoseMgDl = useMemo(() => {
    if (glucoseVal === null) return null;
    return isMmol ? glucoseVal * 18.0182 : glucoseVal;
  }, [glucoseVal, isMmol]);

  const bolusResult = useMemo(() => {
    if (!profile.data?.ic_ratio || !profile.data?.isf) return null;

    return calculateBolus({
      carbs,
      glucose: glucoseMgDl,
      icRatio: profile.data.ic_ratio,
      isf: profile.data.isf,
      targetGlucose: profile.data.target_glucose ?? 100,
    });
  }, [carbs, glucoseMgDl, profile.data]);

  if (profile.isLoading) {
    return (
      <View style={[styles.root, styles.centerContainer, { paddingTop: insets.top + 16 }]}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
        <Text style={[styles.subtitle, { marginTop: 12 }]}>Chargement de vos paramètres...</Text>
      </View>
    );
  }

  if (!profile.data?.ic_ratio || !profile.data?.isf) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16, paddingHorizontal: 16 }]}>
        <View style={styles.card}>
          <View style={styles.emptyStateContainer}>
            <Ionicons name="calculator-outline" size={48} color={colors.brandPrimary} />
            <Text style={styles.emptyTitle}>Profil incomplet</Text>
            <Text style={styles.emptyMessage}>
              Veuillez configurer votre ratio insuline/glucides et votre facteur de sensibilité dans votre profil pour utiliser le calculateur.
            </Text>
          </View>
          <View style={styles.actionSpacing}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.brandPrimary }]}
              onPress={() => router.push("/profil")}
            >
              <Text style={styles.primaryButtonText}>Configurer mon profil</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Calculateur de Bolus</Text>
      <Text style={styles.subtitle}>
        Ratio : 1 U pour {profile.data.ic_ratio} g · Cible : {units.fmt(profile.data.target_glucose ?? 100)} {units.label}
      </Text>

      <View style={styles.card}>
        <Text style={styles.inputLabel}>Glucides du repas (g)</Text>
        <TextInput
          style={styles.textInput}
          value={carbsInput}
          onChangeText={setCarbsInput}
          keyboardType="decimal-pad"
          placeholder="ex: 45"
          placeholderTextColor={colors.muted}
        />

        <View style={styles.inputSpacing}>
          <Text style={styles.inputLabel}>{`Glycémie actuelle (${units.label}) — optionnel`}</Text>
          <TextInput
            style={styles.textInput}
            value={glucoseInput}
            onChangeText={setGlucoseInput}
            keyboardType="decimal-pad"
            placeholder={isMmol ? "ex: 7.2" : "ex: 130"}
            placeholderTextColor={colors.muted}
          />
        </View>
      </View>

      {bolusResult && (
        <View style={styles.resultContainer}>
          <View style={styles.card}>
            <Text style={styles.resultTitle}>Suggestion de Dose</Text>
            <View style={styles.totalRow}>
              <Text style={styles.totalValue}>{round1(bolusResult.total)}</Text>
              <Text style={styles.totalUnit}>Unités (U)</Text>
            </View>

            <View style={styles.tilesRow}>
              <View style={[styles.statTile, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={styles.statTileLabel}>Repas</Text>
                <Text style={[styles.statTileValue, { color: colors.brandPrimary }]}>
                  {round1(bolusResult.carbsDose)} U
                </Text>
              </View>
              <View style={[styles.statTile, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={styles.statTileLabel}>Correction</Text>
                <Text style={[styles.statTileValue, { color: bolusResult.correctionDose < 0 ? colors.warning : colors.info }]}>
                  {round1(bolusResult.correctionDose)} U
                </Text>
              </View>
            </View>

            <Text style={styles.disclaimer}>
              Ce calcul est une aide au dosage basée sur vos paramètres. Adaptez toujours la dose selon votre analyse et l&apos;avis de votre médecin.
            </Text>

            <View style={styles.actionSpacing}>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.brandPrimary }]}
                onPress={() =>
                  router.push({
                    pathname: "/ajouter-insuline",
                    params: {
                      units: String(round1(bolusResult.total)),
                      kind: "repas",
                    },
                  })
                }
              >
                <Text style={styles.primaryButtonText}>Enregistrer cette injection</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  centerContainer: {
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  content: {
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: colors.onSurface,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
    marginBottom: 16,
  },
  card: {
    backgroundColor: colors.surfaceSecondary || colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: 16,
  },
  emptyStateContainer: {
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: colors.onSurface,
    marginTop: 12,
  },
  emptyMessage: {
    textAlign: "center",
    color: colors.muted,
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.onSurface,
    marginBottom: 6,
  },
  textInput: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.onSurface,
    backgroundColor: colors.surface,
  },
  inputSpacing: {
    marginTop: 16,
  },
  resultContainer: {
    marginTop: 8,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.onSurface,
    marginBottom: 8,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginVertical: 12,
  },
  totalValue: {
    fontSize: 48,
    fontWeight: "bold",
    color: colors.brandPrimary,
  },
  totalUnit: {
    fontSize: 18,
    fontWeight: "500",
    color: colors.muted,
  },
  tilesRow: {
    flexDirection: "row",
    gap: 12,
    marginVertical: 12,
  },
  statTile: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  statTileLabel: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 4,
  },
  statTileValue: {
    fontSize: 16,
    fontWeight: "bold",
  },
  disclaimer: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 12,
    lineHeight: 16,
  },
  actionSpacing: {
    marginTop: 16,
  },
  primaryButton: {
    height: 48,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
}));