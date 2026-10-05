import { useEffect, useRef, useState } from "react";
import { Linking, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { uploadMealPhoto, useAddMeal, useProfile, analyzeMealPhoto } from "@/src/api";
import { unitsFor } from "@/src/units";
import { MEAL_TYPE_LABELS, calcBolus, parseNum, round1 } from "@/src/glucose";
import { Card, Chip, ChipRow, PrimaryButton, TextField } from "@/src/components/ui";
import { FoodSearch } from "@/src/components/FoodSearch";
import { useToast } from "@/src/components/Toast";
import type { MealItem, MealType } from "@/src/types";

const MEAL_TYPES: MealType[] = ["petit-dejeuner", "dejeuner", "diner", "collation"];

export default function AjouterRepas() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const profile = useProfile();
  const addMeal = useAddMeal();

  const [mealType, setMealType] = useState<MealType>("dejeuner");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [items, setItems] = useState<MealItem[]>([]);
  const [glucoseText, setGlucoseText] = useState("");
  const [insulinText, setInsulinText] = useState("");
  const [insulinTouched, setInsulinTouched] = useState(false);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);

  const [permModal, setPermModal] = useState<"explain" | "blocked" | null>(null);
  const pendingMode = useRef<"gallery" | "camera">("gallery");

  const carbs = round1(items.reduce((s, i) => s + i.carbs_g, 0));
  const units = unitsFor(profile.data?.glucose_unit);
  const typedGlucose = parseNum(glucoseText);
  const glucose = typedGlucose != null ? units.toMgdl(typedGlucose) : null;
  const calc = calcBolus({ carbs, glucose, profile: profile.data ?? { ic_ratio: 10, isf: 30, target_glucose: 110 } });
  const suggestion = calc.total;

  useEffect(() => {
    if (!insulinTouched) {
      setInsulinText(suggestion > 0 ? String(suggestion) : "");
    }
  }, [suggestion, insulinTouched]);

  const launch = async (mode: "gallery" | "camera") => {
    try {
      const options = { mediaTypes: ["images"] as ["images"], quality: 0.5, allowsEditing: true, aspect: [4, 3] as [number, number], base64: true };
      const result =
        mode === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets?.length) {
        setPhoto(result.assets[0].uri);
        setPhotoBase64(result.assets[0].base64 ?? null);
      }
    } catch {
      toast.show("Impossible d'ouvrir la sélection d'image", "error");
    }
  };

  const startPick = async (mode: "gallery" | "camera") => {
    pendingMode.current = mode;
    const resp =
      mode === "camera"
        ? await ImagePicker.getCameraPermissionsAsync()
        : await ImagePicker.getMediaLibraryPermissionsAsync();
    if (resp.granted) {
      await launch(mode);
    } else if (!resp.canAskAgain) {
      setPermModal("blocked");
    } else {
      setPermModal("explain");
    }
  };

  const confirmPermission = async () => {
    setPermModal(null);
    const resp =
      pendingMode.current === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (resp.granted) {
      await launch(pendingMode.current);
    } else if (!resp.canAskAgain) {
      setPermModal("blocked");
    } else {
      toast.show("Autorisation refusée", "error");
    }
  };

  const analyzePhoto = async () => {
    setAnalyzing(true);
    try {
      let base64 = photoBase64;
      if (!base64 && photo) {
        const blob = await (await fetch(photo)).blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      if (!base64) {
        toast.show("Impossible de lire la photo", "error");
        return;
      }
      const analysis = await analyzeMealPhoto(base64);
      if (!analysis.items.length) {
        toast.show("Aucun aliment détecté sur la photo", "error");
        return;
      }
      const newItems: MealItem[] = analysis.items.map((it) => ({
        name: it.name,
        grams: it.grams,
        carbs_per_100g: it.grams > 0 ? round1((it.carbs_g / it.grams) * 100) : 0,
        carbs_g: it.carbs_g,
      }));
      setItems((prev) => [...prev, ...newItems]);
      toast.show(`≈ ${analysis.total_carbs_g} g de glucides estimés (confiance ${analysis.confidence})`, "success");
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Analyse impossible", "error");
    } finally {
      setAnalyzing(false);
    }
  };


  const save = async () => {
    if (items.length === 0) {
      toast.show("Ajoutez au moins un aliment", "error");
      return;
    }
    let photoPath: string | null = null;
    if (photo) {
      try {
        setUploading(true);
        photoPath = await uploadMealPhoto(photo);
      } catch {
        setUploading(false);
        toast.show("Échec de l'envoi de la photo, réessayez", "error");
        return;
      }
      setUploading(false);
    }
    addMeal.mutate(
      {
        meal_type: mealType,
        name: items[0]?.name ?? "Repas",
        items,
        carbs_g: carbs,
        glucose_before: glucose,
        insulin_units: parseNum(insulinText),
        note: note.trim(),
        photo_path: photoPath,
        eaten_at: new Date().toISOString(),
      },
      {
        onSuccess: () => {
          toast.show("Repas enregistré", "success");
          router.back();
        },
        onError: (e) => toast.show(e.message, "error"),
      },
    );
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView contentContainerStyle={{ paddingTop: insets.top + 16, padding: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nouveau repas</Text>
        <Text style={styles.subtitle}>Photo, glucides et insuline</Text>

        <Card style={{ marginTop: 16 }} testID="photo-card">
          <Text style={styles.cardTitle}>Photo du repas (optionnel)</Text>
          {photo ? (
            <View>
              <Image source={{ uri: photo }} style={styles.photoPreview} contentFit="cover" transition={150} />
              <Pressable
                style={({ pressed }) => [styles.analyzeButton, pressed && { opacity: 0.9 }, analyzing && { opacity: 0.6 }]}
                onPress={analyzePhoto}
                disabled={analyzing}
                testID="analyze-photo-button"
                accessibilityRole="button"
              >
                <Ionicons name="sparkles" size={16} color={colors.onBrandPrimary} />
                <Text style={styles.analyzeText}>{analyzing ? "Analyse en cours…" : "Estimer les glucides avec l'IA"}</Text>
              </Pressable>
              <View style={styles.photoActions}>
                <Pressable onPress={() => startPick("gallery")} style={styles.photoButton} testID="photo-change-button">
                  <Ionicons name="images" size={16} color={colors.onBrandTertiary} />
                  <Text style={styles.photoButtonText}>Changer</Text>
                </Pressable>
                <Pressable onPress={() => { setPhoto(null); setPhotoBase64(null); }} style={styles.photoButton} testID="photo-remove-button">
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                  <Text style={[styles.photoButtonText, { color: colors.error }]}>Retirer</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.photoRow}>
              <Pressable style={styles.photoAddButton} onPress={() => startPick("gallery")} testID="photo-gallery-button">
                <Ionicons name="images" size={20} color={colors.onBrandTertiary} />
                <Text style={styles.photoAddText}>Galerie</Text>
              </Pressable>
              <Pressable style={styles.photoAddButton} onPress={() => startPick("camera")} testID="photo-camera-button">
                <Ionicons name="camera" size={20} color={colors.onBrandTertiary} />
                <Text style={styles.photoAddText}>Appareil photo</Text>
              </Pressable>
            </View>
          )}
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Type de repas</Text>
          <ChipRow>
            {MEAL_TYPES.map((t) => (
              <Chip key={t} label={MEAL_TYPE_LABELS[t]} selected={mealType === t} onPress={() => setMealType(t)} testID={`new-meal-type-${t}`} />
            ))}
          </ChipRow>
        </Card>

        <Card testID="new-meal-foods-card">
          <Text style={styles.cardTitle}>Aliments & glucides</Text>
          <FoodSearch items={items} onItemsChange={setItems} />
          {items.length > 0 ? (
            <Text style={styles.totalCarbs} testID="new-meal-total-carbs">
              Total : {carbs} g de glucides
            </Text>
          ) : null}
        </Card>

        <Card>
          <TextField
            label="Glycémie avant le repas (optionnel)"
            value={glucoseText}
            onChangeText={setGlucoseText}
            placeholder={units.placeholder}
            suffix={units.label}
            keyboardType={units.isMmol ? "decimal" : "numeric"}
            testID="meal-glucose-input"
          />
          <TextField
            label="Insuline injectée (optionnel)"
            value={insulinText}
            onChangeText={(t) => {
              setInsulinTouched(true);
              setInsulinText(t);
            }}
            placeholder={suggestion > 0 ? `≈ ${suggestion} U suggérées` : "Ex : 4"}
            keyboardType="decimal"
            suffix="U"
            testID="meal-insulin-input"
            hint={suggestion > 0 ? `Suggestion calculée : bolus repas ${calc.mealUnits} U${calc.correctionUnits > 0 ? ` + correction ${calc.correctionUnits} U` : ""}` : undefined}
          />
          <TextField label="Note (optionnel)" value={note} onChangeText={setNote} placeholder="Ex : sortie au restaurant" multiline testID="meal-note-input" />
        </Card>

        <PrimaryButton label="Enregistrer le repas" onPress={save} loading={addMeal.isPending || uploading} testID="meal-save-button" />
      </KeyboardAwareScrollView>

      <Modal visible={permModal != null} transparent animationType="fade" onRequestClose={() => setPermModal(null)}>
        <View style={styles.permBackdrop}>
          <View style={styles.permSheet} testID="permission-sheet">
            <Ionicons name="lock-closed" size={28} color={colors.brandPrimary} />
            <Text style={styles.permTitle}>
              {permModal === "blocked" ? "Accès nécessaire" : "Votre photo reste privée"}
            </Text>
            <Text style={styles.permText}>
              {permModal === "blocked"
                ? "Activez l'accès dans les réglages de l'application pour ajouter des photos de repas."
                : "L'accès sert uniquement à ajouter des photos à votre journal de repas. Vos photos ne sont pas partagées."}
            </Text>
            {permModal === "blocked" ? (
              <>
                <PrimaryButton label="Ouvrir les réglages" onPress={() => Linking.openSettings()} testID="permission-open-settings" />
                <Pressable onPress={() => setPermModal(null)} style={styles.permCancel} testID="permission-later-button">
                  <Text style={styles.permCancelText}>Plus tard</Text>
                </Pressable>
              </>
            ) : (
              <>
                <PrimaryButton label="Continuer" onPress={confirmPermission} testID="permission-continue-button" />
                <Pressable onPress={() => setPermModal(null)} style={styles.permCancel} testID="permission-cancel-button">
                  <Text style={styles.permCancelText}>Annuler</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  cardTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 12,
  },
  photoRow: {
    flexDirection: "row",
    gap: 12,
  },
  photoAddButton: {
    flex: 1,
    height: 72,
    borderRadius: 14,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  photoAddText: {
    color: colors.onBrandTertiary,
    fontSize: 13,
    fontWeight: "500",
  },
  photoPreview: {
    width: "100%",
    height: 180,
    borderRadius: 14,
  },
  analyzeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
  },
  analyzeText: {
    color: colors.onBrandPrimary,
    fontSize: 14,
    fontWeight: "500",
  },
  photoActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  photoButton: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  photoButtonText: {
    color: colors.onBrandTertiary,
    fontSize: 13,
    fontWeight: "500",
  },
  totalCarbs: {
    color: colors.brandPrimary,
    fontSize: 14,
    fontWeight: "500",
    marginTop: 12,
  },
  permBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  permSheet: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 20,
    padding: 24,
    gap: 10,
    width: "100%",
    alignItems: "center",
  },
  permTitle: {
    color: colors.onSurface,
    fontSize: 17,
    fontWeight: "500",
    textAlign: "center",
  },
  permText: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 8,
  },
  permCancel: {
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  permCancelText: {
    color: colors.muted,
    fontSize: 14,
  },
}));
