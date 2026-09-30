import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';

// Profil temporaire (à brancher sur ton API FastAPI / profil utilisateur)
const USER_PROFILE = {
  targetGlycemia: 100, // Glycémie cible (mg/dL)
  isf: 40,             // Facteur de sensibilité (1U baissent la glycémie de 40 mg/dL)
  icr: 10,             // Ratio glucides (1U pour 10g de glucides)
};

export default function BolusCalculatorScreen() {
  const [glycemia, setGlycemia] = useState('');
  const [carbs, setCarbs] = useState('');
  const [context, setContext] = useState<'BEFORE_MEAL' | 'AFTER_MEAL' | 'FASTING'>('BEFORE_MEAL');
  const [calculatedBolus, setCalculatedBolus] = useState<number | null>(null);

  const contexts = [
    { id: 'BEFORE_MEAL', label: 'Avant repas' },
    { id: 'AFTER_MEAL', label: 'Après repas' },
    { id: 'FASTING', label: 'À jeun' },
  ];

  const handleCalculate = () => {
    const g = parseFloat(glycemia);
    const c = parseFloat(carbs) || 0;

    if (isNaN(g)) {
      Alert.alert('Erreur', 'Indique au moins une glycémie valide.');
      return;
    }

    // 1. Bolus Repas
    const mealBolus = c / USER_PROFILE.icr;

    // 2. Bolus Correction
    const correctionBolus = Math.max(0, (g - USER_PROFILE.targetGlycemia) / USER_PROFILE.isf);

    // 3. Total arrondi à 0,1 U près
    const total = Math.round((mealBolus + correctionBolus) * 10) / 10;
    setCalculatedBolus(total);
  };

  const handleSave = async () => {
    // Appel API POST vers FastAPI
    Alert.alert('Succès', `Mesure de ${glycemia} mg/dL enregistrée.`);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Saisie & Bolus</Text>

      {/* Choix du moment */}
      <Text style={styles.label}>Moment de la journée</Text>
      <View style={styles.contextContainer}>
        {contexts.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[
              styles.contextOption,
              context === item.id && styles.contextOptionSelected,
            ]}
            onPress={() => setContext(item.id as any)}
          >
            <Text
              style={[
                styles.contextText,
                context === item.id && styles.contextTextSelected,
              ]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Saisie Glycémie */}
      <Text style={styles.label}>Glycémie (mg/dL)</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        placeholder="Ex : 154"
        value={glycemia}
        onChangeText={setGlycemia}
      />

      {/* Saisie Glucides */}
      <Text style={styles.label}>Glucides du repas (g)</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        placeholder="Ex : 60"
        value={carbs}
        onChangeText={setCarbs}
      />

      {/* Bouton de calcul */}
      <TouchableOpacity style={styles.calcButton} onPress={handleCalculate}>
        <Text style={styles.calcButtonText}>Calculer le bolus</Text>
      </TouchableOpacity>

      {/* Résultat du calcul */}
      {calculatedBolus !== null && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>Bolus recommandé</Text>
          <Text style={styles.resultValue}>
            {calculatedBolus} <Text style={styles.unit}>U</Text>
          </Text>

          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>Enregistrer dans le journal</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#f8fafc', flexGrow: 1 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#0f172a', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 8, marginTop: 12 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  contextContainer: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  contextOption: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  contextOptionSelected: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  contextText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  contextTextSelected: { color: '#fff', fontWeight: 'bold' },
  calcButton: {
    backgroundColor: '#0284c7',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 24,
  },
  calcButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  resultCard: {
    backgroundColor: '#e0f2fe',
    borderColor: '#38bdf8',
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    marginTop: 24,
    alignItems: 'center',
  },
  resultTitle: { fontSize: 14, color: '#0369a1', fontWeight: '600' },
  resultValue: { fontSize: 36, fontWeight: 'bold', color: '#0284c7', marginVertical: 8 },
  unit: { fontSize: 20 },
  saveButton: {
    backgroundColor: '#0369a1',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 10,
  },
  saveButtonText: { color: '#fff', fontWeight: 'bold' },
});