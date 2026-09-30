import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, Platform, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function ProfilScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState({
    first_name: 'Patient',
    target_min: '70',
    target_max: '180',
    diabetes_type: 'type1'
  });

  const showNotification = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  // Charger les données du profil de manière sécurisée
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const baseUrl = Platform.OS === 'web' ? '' : 'http://localhost:8000';
        const res = await fetch(`${baseUrl}/api/profile`);

        if (!res.ok) {
          throw new Error(`Erreur HTTP : status ${res.status}`);
        }

        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error("Réponse serveur non valide (format HTML ou non-JSON)");
        }

        const data = await res.json();
        setProfile({
          first_name: data.first_name || 'Patient',
          target_min: data.target_min?.toString() || '70',
          target_max: data.target_max?.toString() || '180',
          diabetes_type: data.diabetes_type || 'type1'
        });
      } catch (e) {
        console.error("Erreur de chargement du profil :", e);
        showNotification('Erreur', 'Impossible de charger le profil depuis le serveur.');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  // Enregistrer les modifications
  const handleSave = async () => {
    setSaving(true);
    try {
      const baseUrl = Platform.OS === 'web' ? '' : 'http://localhost:8000';
      const res = await fetch(`${baseUrl}/api/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: profile.first_name,
          target_min: parseFloat(profile.target_min),
          target_max: parseFloat(profile.target_max),
          diabetes_type: profile.diabetes_type
        })
      });

      if (!res.ok) {
        throw new Error(`Erreur HTTP : status ${res.status}`);
      }

      showNotification('Succès', 'Votre profil a été mis à jour.');
    } catch (e) {
      console.error("Erreur de sauvegarde du profil :", e);
      showNotification('Erreur', 'Échec de la sauvegarde du profil.');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0284c7" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Modifier mon profil</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.avatarContainer}>
          <Ionicons name="person-circle-outline" size={80} color="#0284c7" />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Prénom / Nom</Text>
          <TextInput
            style={styles.input}
            value={profile.first_name}
            onChangeText={(t) => setProfile({ ...profile, first_name: t })}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Cible glycémique basse (mg/dL)</Text>
          <TextInput
            style={styles.input}
            value={profile.target_min}
            keyboardType="numeric"
            onChangeText={(t) => setProfile({ ...profile, target_min: t })}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Cible glycémique haute (mg/dL)</Text>
          <TextInput
            style={styles.input}
            value={profile.target_max}
            keyboardType="numeric"
            onChangeText={(t) => setProfile({ ...profile, target_max: t })}
          />
        </View>

        <TouchableOpacity 
          style={[styles.saveButton, saving && styles.saveButtonDisabled]} 
          onPress={handleSave} 
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.saveButtonText}>Enregistrer</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    backgroundColor: '#ffffff', 
    borderBottomWidth: 1, 
    borderBottomColor: '#e2e8f0' 
  },
  backButton: { marginRight: 12, padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#1e293b' },
  content: { padding: 20 },
  avatarContainer: { alignItems: 'center', marginBottom: 20 },
  formGroup: { marginBottom: 16 },
  label: { fontSize: 14, color: '#475569', marginBottom: 6, fontWeight: '600' },
  input: { 
    backgroundColor: '#ffffff', 
    borderWidth: 1, 
    borderColor: '#cbd5e1', 
    borderRadius: 8, 
    paddingHorizontal: 12, 
    paddingVertical: 10, 
    fontSize: 16,
    color: '#0f172a'
  },
  saveButton: { 
    backgroundColor: '#0284c7', 
    padding: 14, 
    borderRadius: 8, 
    alignItems: 'center', 
    marginTop: 10 
  },
  saveButtonDisabled: { backgroundColor: '#7dd3fc' },
  saveButtonText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' }
});