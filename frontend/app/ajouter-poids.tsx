// app/ajouter-poids.tsx
import { useState, useEffect } from "react";
import { Pressable, Text, View, ScrollView, Alert, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router"; 

import { makeStyles, useTheme } from "@/src/theme";
import { Card, Button } from "@/src/components/ui";

export default function AjouterPoids() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter(); 

  const [weight, setWeight] = useState("");
  const [weightHistory, setWeightHistory] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const handleSave = async () => {
    const val = parseFloat(weight.replace(",", "."));
    if (isNaN(val) || val <= 0) {
      Alert.alert("Erreur", "Veuillez entrer un poids valide.");
      return;
    }

    setIsSaving(true);

    try {
      // Simulation locale immédiate pour valider l'interface si le backend refuse la connexion directe du navigateur
      const newEntry = {
        id: Date.now().toString(),
        weight_kg: val,
        measured_at: new Date().toISOString()
      };

      setWeightHistory(prev => [newEntry, ...prev]);
      Alert.alert("Succès", "Poids enregistré avec succès !");
      setWeight("");
    } catch (err: any) {
      Alert.alert("Erreur", "Impossible d'enregistrer.");
    } finally {
      setIsSaving(false);
    }
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
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              value={weight}
              onChangeText={setWeight}
              placeholder="Ex : 70.5"
              keyboardType="decimal-pad"
            />
            <Text style={styles.suffix}>kg</Text>
          </View>
          <Button
            title={isSaving ? "Enregistrement..." : "Enregistrer"}
            onPress={handleSave}
            disabled={isSaving}
          />
        </Card>

        <Card style={{ marginTop: 16 }}>
          <Text style={styles.cardTitle}>Historique des pesées</Text>
          {weightHistory.length > 0 ? (
            weightHistory.map((item: any) => (
              <View key={item.id} style={styles.weightRow}>
                <View>
                  <Text style={styles.weightValue}>{item.weight_kg} kg</Text>
                  <Text style={styles.weightDate}>
                    {new Date(item.measured_at).toLocaleDateString()}
                  </Text>
                </View>
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
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 8 },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "500" },
  cardTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "500", marginBottom: 12 },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    marginBottom: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  textInput: { flex: 1, paddingVertical: 12, fontSize: 16, color: '#000' },
  suffix: { fontSize: 16, color: '#666', fontWeight: '500', marginLeft: 8 },
  weightRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  weightValue: { color: colors.onSurface, fontSize: 16, fontWeight: "600" },
  weightDate: { color: colors.muted, fontSize: 12, marginTop: 2 },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center", paddingVertical: 16 },
}));