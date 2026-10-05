import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useQueryClient } from "@tanstack/react-query";

import { makeStyles, useTheme } from "@/src/theme";
import { importLibreviewBatch, type ImportResult } from "@/src/api";
import { Card, PrimaryButton } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";

const BATCH_LINES = 4000;

const STEPS = [
  "Connectez-vous sur libreview.com (ordinateur ou navigateur du téléphone).",
  "Menu ☰ › « Télécharger les données du glucose » › confirmez : vous obtenez le fichier glucose_data.csv.",
  "Revenez ici et choisissez ce fichier : glycémies, insuline et glucides sont importés sans doublon.",
];

async function readFileText(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === "web") {
    if (asset.file) return asset.file.text();
    const res = await fetch(asset.uri);
    return res.text();
  }
  return new File(asset.uri).text();
}

/** Découpe le CSV en lots, en répétant les lignes d'en-tête (avant la ligne « Type d'enregistrement ») dans chaque lot. */
function splitBatches(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerEnd = lines.findIndex((l) => /record type|type d.enregistrement/i.test(l));
  if (headerEnd < 0) throw new Error("Ce fichier ne ressemble pas à un export LibreView (glucose_data.csv)");
  const header = lines.slice(0, headerEnd + 1);
  const body = lines.slice(headerEnd + 1);
  const batches: string[][] = [];
  for (let i = 0; i < body.length; i += BATCH_LINES) {
    batches.push([...header, ...body.slice(i, i + BATCH_LINES)]);
  }
  return batches.length ? batches : [header];
}

export default function ImportLibreview() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const pickAndImport = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain", "*/*"], copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setBusy(true);
    setResult(null);
    setFileName(asset.name);
    try {
      const text = await readFileText(asset);
      const batches = splitBatches(text);
      setProgress({ done: 0, total: batches.length });
      const total: ImportResult = { readings_parsed: 0, readings_inserted: 0, insulin_inserted: 0, meals_inserted: 0, skipped: 0 };
      for (let i = 0; i < batches.length; i += 1) {
        const r = await importLibreviewBatch(batches[i], i);
        total.readings_parsed += r.readings_parsed;
        total.readings_inserted += r.readings_inserted;
        total.insulin_inserted += r.insulin_inserted;
        total.meals_inserted += r.meals_inserted;
        total.skipped += r.skipped;
        setProgress({ done: i + 1, total: batches.length });
      }
      setResult(total);
      qc.invalidateQueries();
      toast.show(total.readings_inserted > 0 ? `${total.readings_inserted} glycémies importées` : "Aucune nouvelle donnée (déjà importées)", "success");
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Import impossible", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} testID="import-back-button" accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Importer LibreView</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
        <Card testID="import-steps-card">
          <Text style={styles.cardTitle}>Récupérer votre historique en 3 étapes</Text>
          {STEPS.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
          <Text style={styles.hint}>Formats acceptés : export LibreView en français ou en anglais, en mg/dL ou mmol/L. Les données déjà présentes ne sont pas dupliquées.</Text>
        </Card>

        <PrimaryButton
          label={busy && progress ? `Import en cours… ${progress.done}/${progress.total}` : "Choisir le fichier glucose_data.csv"}
          onPress={pickAndImport}
          loading={busy}
          icon={<Ionicons name="document-attach-outline" size={18} color={colors.onBrandPrimary} />}
          testID="import-pick-button"
        />

        {result ? (
          <Card style={{ marginTop: 16 }} testID="import-result-card">
            <View style={styles.resultHeader}>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <Text style={styles.cardTitle}>Import terminé{fileName ? ` · ${fileName}` : ""}</Text>
            </View>
            {[
              ["Glycémies ajoutées", result.readings_inserted, `sur ${result.readings_parsed} lues`],
              ["Injections d'insuline", result.insulin_inserted, "bolus et basale"],
              ["Repas (glucides)", result.meals_inserted, ""],
              ["Lignes ignorées", result.skipped, "date illisible"],
            ].map(([label, value, meta]) => (
              <View key={String(label)} style={styles.resultRow}>
                <Text style={styles.resultLabel}>{label}</Text>
                <Text style={styles.resultValue}>
                  {value} <Text style={styles.resultMeta}>{meta}</Text>
                </Text>
              </View>
            ))}
            <PrimaryButton label="Voir mes statistiques" onPress={() => router.replace("/(tabs)/stats")} variant="secondary" testID="import-go-stats" />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
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
  cardTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 10,
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
  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  resultLabel: {
    color: colors.onSurfaceSecondary,
    fontSize: 14,
  },
  resultValue: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  resultMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "400",
  },
}));
