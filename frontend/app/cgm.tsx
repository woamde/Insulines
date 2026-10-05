import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

// Utilisation de 127.0.0.1 au lieu de localhost pour éviter les problèmes de résolution DNS réseau
const API_BASE_URL = 'http://127.0.0.1:8000/api';

export default function CgmScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const handleTest = async () => {
    if (!email || !password) {
      setMessage({ text: 'Veuillez saisir votre email et mot de passe.', type: 'error' });
      return;
    }
    
    setTesting(true);
    setMessage(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/cgm/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setMessage({ text: data.message || 'Connexion testée avec succès !', type: 'success' });
      } else {
        setMessage({ text: data.detail || 'Échec du test de connexion.', type: 'error' });
      }
    } catch (e: any) {
      console.error("Erreur test CGM:", e);
      setMessage({ text: 'Erreur réseau ou serveur inaccessible. Le backend est-il lancé ?', type: 'error' });
    } finally {
      // Garantit que le bouton arrête de charger, même en cas de crash
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!email || !password) {
      setMessage({ text: 'Veuillez saisir votre email et mot de passe.', type: 'error' });
      return;
    }
    
    setLoading(true);
    setMessage(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/cgm/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, source: 'libre', region: 'fr' }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setMessage({ text: 'Paramètres CGM enregistrés avec succès !', type: 'success' });
      } else {
        setMessage({ text: data.detail || 'Erreur lors de l’enregistrement.', type: 'error' });
      }
    } catch (e: any) {
      console.error("Erreur save CGM:", e);
      setMessage({ text: 'Erreur réseau ou serveur inaccessible. Le backend est-il lancé ?', type: 'error' });
    } finally {
       // Garantit que le bouton arrête de charger, même en cas de crash
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.header}>
        <Pressable 
          onPress={handleBack} 
          style={styles.backButton}
          testID="cgm-back-button"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={24} color="#333" />
        </Pressable>
        <Text style={styles.headerTitle}>Configuration CGM (LibreLinkUp)</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>
          Entrez vos identifiants LibreLinkUp pour synchroniser vos données glycémiques en temps réel.
        </Text>

        {message && (
          <View style={[styles.alert, message.type === 'success' ? styles.alertSuccess : styles.alertError]}>
            <Text style={styles.alertText}>{message.text}</Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email / Identifiant LibreLinkUp</Text>
          <TextInput
            style={styles.input}
            placeholder="votre.email@exemple.com"
            placeholderTextColor="#999"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Mot de passe</Text>
          <TextInput
            style={styles.input}
            placeholder="Mot de passe"
            placeholderTextColor="#999"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </View>

        <View style={styles.buttonContainer}>
          <Pressable 
            style={[styles.button, styles.testButton, testing && styles.buttonDisabled]} 
            onPress={handleTest}
            disabled={testing || loading}
          >
            {testing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Tester la connexion</Text>
            )}
          </Pressable>

          <Pressable 
            style={[styles.button, styles.saveButton, loading && styles.buttonDisabled]} 
            onPress={handleSave}
            disabled={loading || testing}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Enregistrer</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f6fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e8ed',
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1da1f2',
  },
  scrollContent: {
    padding: 20,
  },
  subtitle: {
    fontSize: 14,
    color: '#657786',
    marginBottom: 20,
    lineHeight: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#14171a',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccd6dd',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#14171a',
  },
  buttonContainer: {
    marginTop: 24,
    gap: 12,
  },
  button: {
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  testButton: {
    backgroundColor: '#17bf63',
  },
  saveButton: {
    backgroundColor: '#1da1f2',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  alert: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  alertSuccess: {
    backgroundColor: '#e1f5fe',
    borderColor: '#b3e5fc',
    borderWidth: 1,
  },
  alertError: {
    backgroundColor: '#ffebee',
    borderColor: '#ffcdd2',
    borderWidth: 1,
  },
  alertText: {
    fontSize: 14,
    color: '#0d3c55',
  },
});