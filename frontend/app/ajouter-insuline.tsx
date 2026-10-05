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
import { useRouter, useLocalSearchParams } from 'expo-router';

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://127.0.0.1:8002";

export default function AjouterInsulineScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // Récupération sécurisée des paramètres d'URL s'ils existent
  const initialUnits = params?.units ? String(params.units) : '';
  const rawKind = params?.kind ? String(params.kind) : 'bolus';
  const initialKind = ['bolus', 'basal'].includes(rawKind) ? rawKind : 'bolus';

  const [units, setUnits] = useState(initialUnits);
  const [glycemia, setGlycemia] = useState('');
  const [note, setNote] = useState('');

  const handleSaveSimultaneous = async () => {
    const g = parseFloat(glycemia);
    const u = parseFloat(units);

    if (isNaN(g) && isNaN(u)) {
      Alert.alert('Erreur', 'Veuillez renseigner au moins une glycémie ou une dose d\'insuline.');
      return;
    }

    try {
      const token = typeof window !== 'undefined' ? (localStorage.getItem('token') || localStorage.getItem('session_token')) : '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Horodatage unique et partagé pour lier parfaitement les deux entrées dans le journal
      const exactTimestamp = new Date().toISOString();

      // 1. Enregistrement de la glycémie si renseignée (avec slash final pour éviter l'erreur 405)
      if (!isNaN(g)) {
        const resGluc = await fetch(`${API_URL}/api/glucose/`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            value_mgdl: g,
            source: 'manuel',
            measured_at: exactTimestamp,
            note: note ? `Note : ${note}` : 'Saisie groupée'
          })
        });

        if (!resGluc.ok) {
          const errorData = await resGluc.json().catch(() => ({}));
          const errorMsg = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail || errorData);
          throw new Error(errorMsg || `Erreur lors de l'enregistrement de la glycémie (${resGluc.status})`);
        }
      }

      // 2. Enregistrement de l'insuline si renseignée (avec slash final pour éviter l'erreur 405)
      if (!isNaN(u) && u > 0) {
        const resIns = await fetch(`${API_URL}/api/insulin/`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            units: u,
            kind: initialKind,
            insulin_name: 'humalog',
            injected_at: exactTimestamp,
            note: note ? `Note : ${note}` : 'Saisie groupée'
          })
        });

        if (!resIns.ok) {
          const errorData = await resIns.json().catch(() => ({}));
          const errorMsg = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail || errorData);
          throw new Error(errorMsg || `Erreur lors de l'enregistrement de l'insuline (${resIns.status})`);
        }
      }

      Alert.alert('Succès', 'Données enregistrées avec succès !', [
        {
          text: 'OK',
          onPress: () => {
            // Navigation sécurisée (vérification que la route existe et n'est pas nulle)
            if (router && typeof router.push === 'function') {
              router.push('/journal');
            }
          }
        }
      ]);

    } catch (err: any) {
      console.error("Erreur synchrone/réseau détaillée :", err);
      Alert.alert('Erreur', err?.message || "Impossible d'enregistrer les données.");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Ajout combiné (Glycémie & Insuline)</Text>

      <Text style={styles.label}>Glycémie (mg/dL)</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        placeholder="Ex : 140"
        value={glycemia}
        onChangeText={setGlycemia}
      />

      <Text style={styles.label}>Unités d'insuline (U)</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        placeholder="Ex : 5.8"
        value={units}
        onChangeText={setUnits}
      />

      <Text style={styles.label}>Note (optionnelle)</Text>
      <TextInput
        style={styles.input}
        placeholder="Ex : Repas du midi"
        value={note}
        onChangeText={setNote}
      />

      <TouchableOpacity style={styles.saveButton} onPress={handleSaveSimultaneous}>
        <Text style={styles.saveButtonText}>Enregistrer tout dans le journal</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#f8fafc', flexGrow: 1 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0f172a', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 8, marginTop: 12 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: '#0284c7',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 24,
  },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});