import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';

const API_BASE_URL = 'http://127.0.0.1:8002/api';

export default function CalculateurScreen() {
  const [glycemia, setGlycemia] = useState<string>('');
  const [carbs, setCarbs] = useState<string>('');
  const [target, setTarget] = useState<string>('100');
  const [icRatio, setIcRatio] = useState<string>('10'); // 1 U pour X grammes de glucides
  const [isf, setIsf] = useState<string>('40');         // 1 U fait baisser la glycémie de X mg/dL
  const [result, setResult] = useState<{ mealBolus: number; correctionBolus: number; totalBolus: number } | null>(null);

  useEffect(() => {
    // Chargement des paramètres du profil utilisateur
    fetch(`${API_BASE_URL}/profile`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ic_ratio) setIcRatio(String(data.ic_ratio));
        if (data.isf) setIsf(String(data.isf));
        if (data.target_glycemia) setTarget(String(data.target_glycemia));
      })
      .catch(() => {});
  }, []);

  const handleCalculate = () => {
    const g = parseFloat(glycemia);
    const c = parseFloat(carbs) || 0;
    const t = parseFloat(target) || 100;
    const ratio = parseFloat(icRatio);
    const sens = parseFloat(isf);

    if (isNaN(g) || isNaN(ratio) || isNaN(sens) || ratio <= 0 || sens <= 0) {
      Alert.alert('Erreur', 'Veuillez renseigner au moins une glycémie valide et des ratios corrects.');
      return;
    }

    // Calcul du bolus pour le repas
    const mealBolus = c > 0 ? c / ratio : 0;

    // Calcul du bolus de correction
    const correctionBolus = (g - t) / sens;

    // Bolus total (arrondi au dixième, minimum 0)
    const rawTotal = mealBolus + correctionBolus;
    const totalBolus = rawTotal > 0 ? Math.round(rawTotal * 10) / 10 : 0;

    setResult({
      mealBolus: Math.round(mealBolus * 10) / 10,
      correctionBolus: Math.round(correctionBolus * 10) / 10,
      totalBolus,
    });
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Calculateur de Bolus</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Glycémie actuelle (mg/dL)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="Ex : 180"
          value={glycemia}
          onChangeText={setGlycemia}
        />

        <Text style={styles.label}>Glucides du repas (g)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="Ex : 45"
          value={carbs}
          onChangeText={setCarbs}
        />

        <View style={styles.row}>
          <View style={styles.halfField}>
            <Text style={styles.subLabel}>Cible (mg/dL)</Text>
            <TextInput
              style={styles.smallInput}
              keyboardType="numeric"
              value={target}
              onChangeText={setTarget}
            />
          </View>
          <View style={styles.halfField}>
            <Text style={styles.subLabel}>Ratio (g/U)</Text>
            <TextInput
              style={styles.smallInput}
              keyboardType="numeric"
              value={icRatio}
              onChangeText={setIcRatio}
            />
          </View>
          <View style={styles.halfField}>
            <Text style={styles.subLabel}>ISF (mg/dL/U)</Text>
            <TextInput
              style={styles.smallInput}
              keyboardType="numeric"
              value={isf}
              onChangeText={setIsf}
            />
          </View>
        </View>

        <TouchableOpacity style={styles.button} onPress={handleCalculate}>
          <Text style={styles.buttonText}>Calculer la dose</Text>
        </TouchableOpacity>
      </View>

      {result && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>Dose recommandée</Text>
          <Text style={styles.totalValue}>{result.totalBolus} U</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailText}>Bolus Repas : {result.mealBolus} U</Text>
            <Text style={styles.detailText}>Correction : {result.correctionBolus > 0 ? `+${result.correctionBolus}` : result.correctionBolus} U</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 60 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 20 },
  card: { backgroundColor: '#f9f9f9', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#eee' },
  label: { fontSize: 14, fontWeight: '600', marginTop: 10, marginBottom: 4 },
  subLabel: { fontSize: 11, color: '#666', marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16 },
  row: { flexDirection: 'row', gap: 8, marginTop: 12 },
  halfField: { flex: 1 },
  smallInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8, fontSize: 14, textAlign: 'center' },
  button: { backgroundColor: '#007aff', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 18 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  resultCard: { backgroundColor: '#e3f2fd', padding: 20, borderRadius: 12, marginTop: 20, alignItems: 'center' },
  resultTitle: { fontSize: 14, color: '#1565c0', fontWeight: '600' },
  totalValue: { fontSize: 36, fontWeight: 'bold', color: '#0d47a1', my: 8 },
  detailRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
  detailText: { fontSize: 13, color: '#1565c0' },
});