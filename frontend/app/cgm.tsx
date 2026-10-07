import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'user_token';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8002/api';

// Helper API autonome (évite les erreurs de cache d'importation Metro)
async function sendCgmRequest(endpoint: string, credentials: { email: string; password: string }) {
  let token: string | null = null;

  if (Platform.OS === 'web') {
    try {
      token = localStorage.getItem(TOKEN_KEY);
    } catch (e) {
      console.error(e);
    }
  } else {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const cleanBase = API_BASE_URL.replace(/\/$/, '');
  const cleanEndpoint = endpoint.replace(/^\//, '');

  const response = await fetch(`${cleanBase}/${cleanEndpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(credentials),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail || data.message || `Erreur serveur (${response.status})`);
  }

  return data;
}

export default function CgmScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('hatif.abderahim@free.fr');
  const [password, setPassword] = useState('');
  const [loadingTest, setLoadingTest] = useState(false);
  const [loadingSave, setLoadingSave] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleTestConnection = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email || !password) {
      setErrorMessage('Veuillez saisir l’email et le mot de passe.');
      return;
    }

    setLoadingTest(true);
    try {
      const res = await sendCgmRequest('/cgm/test', { email, password });
      setSuccessMessage(res.message || 'Connexion réussie !');
    } catch (error: any) {
      setErrorMessage(error.message || 'Erreur lors du test de connexion.');
    } finally {
      setLoadingTest(false);
    }
  };

  const handleSave = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email || !password) {
      setErrorMessage('Veuillez saisir l’email et le mot de passe.');
      return;
    }

    setLoadingSave(true);
    try {
      const res = await sendCgmRequest('/cgm/settings', { email, password });
      setSuccessMessage(res.message || 'Configuration enregistrée avec succès.');
    } catch (error: any) {
      setErrorMessage(error.message || 'Erreur lors de l’enregistrement.');
    } finally {
      setLoadingSave(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>‹ Configuration CGM (LibreLinkUp)</Text>
      </TouchableOpacity>

      <Text style={styles.subtitle}>
        Entrez vos identifiants LibreLinkUp pour synchroniser vos données glycémiques en temps réel.
      </Text>

      {errorMessage && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      )}

      {successMessage && (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>{successMessage}</Text>
        </View>
      )}

      <Text style={styles.label}>Email / Identifiant LibreLinkUp</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="exemple@domaine.fr"
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <Text style={styles.label}>Mot de passe</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••••••"
        secureTextEntry
      />

      <TouchableOpacity
        style={[styles.button, styles.testButton]}
        onPress={handleTestConnection}
        disabled={loadingTest || loadingSave}
      >
        {loadingTest ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>Tester la connexion</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.saveButton]}
        onPress={handleSave}
        disabled={loadingTest || loadingSave}
      >
        {loadingSave ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>Enregistrer</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 24,
  },
  backButton: {
    marginBottom: 16,
  },
  backButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 20,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
  },
  successBanner: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  successText: {
    color: '#16A34A',
    fontSize: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1E293B',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0F172A',
    marginBottom: 16,
  },
  button: {
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  testButton: {
    backgroundColor: '#10B981',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});