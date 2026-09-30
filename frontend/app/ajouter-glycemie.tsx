import { useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { makeStyles, useTheme } from "@/src/theme";
import { useAddGlucose, useProfile, useUpdateGlucose } from "@/src/api";
import { unitsFor } from "@/src/units";
import { parseNum } from "@/src/glucose";
import { Card, PrimaryButton, TextField } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";

export default function AjouterGlycemie() {
  const insets = useSafeAreaInsets();
  useTheme();
  const styles = useStyles();
  const toast = useToast();
  const profile = useProfile();

  const params = useLocalSearchParams<{ id?: string; initialValue?: string; initialNote?: string }>();
  const isEditing = Boolean(params.id);

  const addGlucose = useAddGlucose();
  const updateGlucose = useUpdateGlucose();

  const [valueText, setValueText] = useState(params.initialValue ?? "");
  const [note, setNote] = useState(params.initialNote ?? "");

  const units = unitsFor(profile.data?.glucose_unit);
  const parsed = parseNum(valueText);
  const glucoseMgdl = parsed != null ? units.toMgdl(parsed) : null;
  const valid = glucoseMgdl != null && glucoseMgdl >= 20 && glucoseMgdl <= 600;

  const save = () => {
    if (!valid || glucoseMgdl == null) return;

    const nowIso = new Date().toISOString();

    if (isEditing && params.id) {
      updateGlucose.mutate(
        {
          id: params.id,
          value_mgdl: glucoseMgdl,
          note: note.trim(),
        } as any,
        {
          onSuccess: () => {
            toast.show("Glycémie mise à jour avec succès", "success");
            router.back();
          },
          onError: (e) => {
            toast.show(e.message || "Erreur lors de la modification", "error");
          },
        }
      );
    } else {
      addGlucose.mutate(
        {
          value_mgdl: glucoseMgdl,
          measured_at: nowIso,
          date: nowIso,
          context: "manual",
          note: note.trim(),
        } as any,
        {
          onSuccess: () => {
            toast.show("Glycémie enregistrée avec succès", "success");
            router.back();
          },
          onError: (e) => {
            toast.show(e.message || "Erreur lors de l'enregistrement", "error");
          },
        }
      );
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          padding: 16,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{isEditing ? "Modifier la glycémie" : "Nouvelle glycémie"}</Text>
        <Text style={styles.subtitle}>{isEditing ? "Mettez à jour votre mesure" : "Enregistrez votre mesure manuelle"}</Text>

        <Card style={{ marginTop: 16 }} testID="glucose-form-card">
          <TextField
            label="Taux de glucose"
            value={valueText}
            onChangeText={setValueText}
            placeholder={units.placeholder}
            suffix={units.label}
            keyboardType={units.isMmol ? "decimal" : "numeric"}
            big
            testID="glucose-value-input"
          />

          <View style={{ height: 8 }} />

          <TextField
            label="Note (optionnel)"
            value={note}
            onChangeText={setNote}
            placeholder="Ex : avant le repas, correction sport..."
            multiline
            testID="glucose-note-input"
          />
        </Card>

        <PrimaryButton
          label={isEditing ? "Mettre à jour" : "Enregistrer la glycémie"}
          onPress={save}
          loading={addGlucose.isPending || updateGlucose?.isPending}
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
}));