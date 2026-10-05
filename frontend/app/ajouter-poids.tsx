// app/ajouter-poids.tsx
import { useState } from "react";
import { Pressable, Text, View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { router } from "@/src/utils/router";
import { makeStyles, useTheme } from "@/src/theme";
import { useWeightHistory, useAddWeight, useDeleteWeight } from "@/src/api";
import { Card, TextField, Button } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";

export default function AjouterPoids() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();

  const [weight, setWeight] = useState("");
  const weightHistory = useWeightHistory();
  const addWeightMutation = useAddWeight();
  const deleteWeightMutation = useDeleteWeight();

  const handleBack = () => {
    router.back();
  };

  const handleSave = () => {
    const val = parseFloat(weight.replace(",", "."));
    if (isNaN(val) || val <= 0) {
      toast.show("Veuillez entrer un poids valide", "error");
      return;
    }
    addWeightMutation.mutate(
      { weight_kg: val },
      {
        onSuccess: () => {
          toast.show("Poids enregistré avec succès", "success");
          setWeight("");
        },
        onError: (err: any) => {
          toast.show(err.message || "Erreur lors de l'enregistrement", "error");
        },
      }
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={handleBack} style={styles.backButton} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Suivi du poids</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card>
          <Text style={styles.cardTitle}>Ajouter une pesée</Text>
          <TextField
            label="Poids (kg)"
            value={weight}
            onChangeText={setWeight}
            placeholder="Ex : 70.5"
            keyboardType="decimal-pad"
            suffix="kg"
          />
          <Button
            title="Enregistrer"
            onPress={handleSave}
            disabled={addWeightMutation.isPending}
          />
        </Card>

        <Card style={{ marginTop: 16 }}>
          <Text style={styles.cardTitle}>Historique des pesées</Text>
          {weightHistory.data && weightHistory.data.length > 0 ? (
            weightHistory.data.map((item: any, index: number) => (
              <View key={item.id || index} style={styles.weightRow}>
                <View>
                  <Text style={styles.weightValue}>{item.weight_kg} kg</Text>
                  <Text style={styles.weightDate}>
                    {new Date(item.date || item.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <Pressable
                  onPress={() => deleteWeightMutation.mutate(item.id)}
                  style={styles.deleteButton}
                  accessibilityRole="button"
                >
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>Aucune pesée enregistrée pour le moment</Text>
          )}
        </Card>
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
    marginBottom: 12,
  },
  weightRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  weightValue: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "600",
  },
  weightDate: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  deleteButton: {
    padding: 8,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 16,
  },
}));