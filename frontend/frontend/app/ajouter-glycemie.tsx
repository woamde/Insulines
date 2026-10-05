import { useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { makeStyles, useTheme } from "@/src/theme";
import { useAddGlucose, useProfile } from "@/src/api";
import { unitsFor } from "@/src/units";
import { scheduleHypoRecheck } from "@/src/notifications";
import { CONTEXT_LABELS, glucoseZone, parseNum, targetsOf, zoneColor, zoneLabel } from "@/src/glucose";
import { Badge, Card, Chip, ChipRow, PrimaryButton, TextField } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";

const CONTEXTS = [
  { key: "a-jeun", label: "À jeun" },
  { key: "avant-repas", label: "Avant repas" },
  { key: "apres-repas", label: "Après repas" },
  { key: "coucher", label: "Coucher" },
];

export default function AjouterGlycemie() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const add = useAddGlucose();
  const profile = useProfile();
  const targets = targetsOf(profile.data);
  const units = unitsFor(profile.data?.glucose_unit);

  const [value, setValue] = useState("");
  const [context, setContext] = useState("avant-repas");
  const [note, setNote] = useState("");

  const typed = parseNum(value);
  // Conversion vers l'unité de stockage (mg/dL) quelle que soit l'unité d'affichage
  const parsed = typed != null ? units.toMgdl(typed) : null;
  const valid = parsed != null && parsed > 0 && parsed <= 1000;
  const zone = valid ? glucoseZone(parsed, targets) : null;

  const save = () => {
    if (!valid || parsed == null) return;
    add.mutate(
      { value_mgdl: parsed, context, note: note.trim() },
      {
        onSuccess: async () => {
          if (parsed < targets.low) {
            const scheduled = await scheduleHypoRecheck(15);
            toast.show(scheduled ? "Hypo enregistrée · rappel de recontrôle dans 15 min" : "Hypo enregistrée · recontrôlez dans 15 min", "error");
          } else {
            toast.show("Glycémie enregistrée", "success");
          }
          router.back();
        },
        onError: (e) => toast.show(e.message, "error"),
      },
    );
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView contentContainerStyle={{ paddingTop: insets.top + 16, padding: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nouvelle glycémie</Text>
        <Text style={styles.subtitle}>Mesure capillaire en {units.label}</Text>

        <Card style={{ marginTop: 16 }} testID="glucose-form-card">
          <TextField
            label="Glycémie"
            value={value}
            onChangeText={setValue}
            placeholder={units.placeholder}
            keyboardType={units.isMmol ? "decimal" : "numeric"}
            suffix={units.label}
            big
            testID="glucose-value-input"
          />
          <View style={styles.previewRow}>
            {zone ? (
              <>
                <Badge text={`${units.fmt(parsed!)} ${units.label}`} color={zoneColor(zone, colors)} testID="glucose-preview-badge" />
                <Text style={styles.previewLabel}>{zoneLabel(zone)}</Text>
              </>
            ) : (
              <Text style={styles.previewLabel}>Votre plage cible : {units.fmt(targets.low)}–{units.fmt(targets.high)} {units.label}</Text>
            )}
          </View>
        </Card>

        <Card>
          <Text style={styles.label}>Moment de la mesure</Text>
          <ChipRow>
            {CONTEXTS.map((c) => (
              <Chip key={c.key} label={c.label} selected={context === c.key} onPress={() => setContext(c.key)} testID={`glucose-context-${c.key}`} />
            ))}
          </ChipRow>
          <TextField label="Note (optionnel)" value={note} onChangeText={setNote} placeholder="Ex : après une balade" testID="glucose-note-input" multiline />
        </Card>

        <PrimaryButton
          label={CONTEXT_LABELS[context] ? `Enregistrer (${CONTEXT_LABELS[context].toLowerCase()})` : "Enregistrer"}
          onPress={save}
          loading={add.isPending}
          disabled={!valid}
          testID="glucose-save-button"
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  title: {
    color: colors.onSurface,
    fontSize: 22,
    fontWeight: "500",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    flexWrap: "wrap",
  },
  previewLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  label: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 8,
  },
}));
