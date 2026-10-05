import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useProfile } from "@/src/api";
import { Card, EmptyState, LoadingState, PrimaryButton, StatTile } from "@/src/components/ui";
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
      <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
        <LoadingState label="Chargement de vos paramètres..." />
      </View>
    );
  }

  if (!profile.data?.ic_ratio || !profile.data?.isf) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16, paddingHorizontal: 16 }]}>
        <Card>
          <EmptyState
            icon={<Ionicons name="calculator-outline" size={48} color={colors.brandPrimary} />}
            title="Profil incomplet"
            message="Veuillez configurer votre ratio insuline/glucides et votre facteur de sensibilité dans votre profil pour utiliser le calculateur."
          />
          <View style={styles.actionSpacing}>
            <PrimaryButton
              label="Configurer mon profil"
              onPress={() => router.push("/profil")}
            />
          </View>
        </Card>
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

      <Card>
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
      </Card>

      {bolusResult && (
        <View style={styles.resultContainer}>
          <Card>
            <Text style={styles.resultTitle}>Suggestion de Dose</Text>
            <View style={styles.totalRow}>
              <Text style={styles.totalValue}>{round1(bolusResult.total)}</Text>
              <Text style={styles.totalUnit}>Unités (U)</Text>
            </View>

            <View style={styles.tilesRow}>
              <StatTile
                label="Repas"
                value={`${round1(bolusResult.carbsDose)}`}
                unit="U"
                color={colors.brandPrimary}
              />
              <StatTile
                label="Correction"
                value={`${round1(bolusResult.correctionDose)}`}
                unit="U"
                color={bolusResult.correctionDose < 0 ? colors.warning : colors.info}
              />
            </View>

            <Text style={styles.disclaimer}>
              Ce calcul est une aide au dosage basée sur vos paramètres. Adaptez toujours la dose selon votre analyse et l&apos;avis de votre médecin.
            </Text>

            <View style={styles.actionSpacing}>
              <PrimaryButton
                label="Enregistrer cette injection"
                onPress={() =>
                  router.push({
                    pathname: "/ajouter-insuline",
                    params: {
                      units: String(round1(bolusResult.total)),
                      kind: "repas",
                    },
                  })
                }
              />
            </View>
          </Card>
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
    backgroundColor: colors.surfaceSecondary,
  },
  inputSpacing: {
    marginTop: 16,
  },
  resultContainer: {
    marginTop: 16,
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
  disclaimer: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 12,
    lineHeight: 16,
  },
  actionSpacing: {
    marginTop: 16,
  },
}));