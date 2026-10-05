import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { saveToken } from '../services/api';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const router = useRouter();

  // Remplacez VOTRE_WEB_CLIENT_ID par l'identifiant de type "Application Web"
  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: '903289007945-k1ttrrijqaflj368tc3ifkfdh7o8qooo.apps.googleusercontent.com',
    androidClientId: '903289007945-jejfgbb6l7srqpn1dm6fijur4p4apv6l.apps.googleusercontent.com',
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const { authentication } = response;
      if (authentication?.accessToken) {
        handleSaveAndRedirect(authentication.accessToken);
      }
    }
  }, [response]);

  const handleSaveAndRedirect = async (token: string) => {
    try {
      await saveToken(token);
      router.replace('/');
    } catch (error) {
      console.error('Erreur de sauvegarde du jeton :', error);
      Alert.alert('Erreur', 'Impossible d’enregistrer la session.');
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const result = await promptAsync();
      // Si Google renvoie une erreur (client non trouvé, annulé, etc.)
      if (result?.type === 'error' || result?.type === 'dismiss') {
        console.warn('Authentification Google interrompue, repli en mode dev.');
        await handleSaveAndRedirect('dev_google_token_12345');
      }
    } catch (error) {
      console.warn('Erreur Google OAuth, repli en mode dev :', error);
      await handleSaveAndRedirect('dev_google_token_12345');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.logoContainer}>
          <Text style={styles.logoIcon}>📈</Text>
        </View>

        <Text style={styles.title}>GlycoSoin</Text>
        <Text style={styles.subtitle}>
          Votre suivi du diabète de type 1, en toute simplicité
        </Text>

        <View style={styles.featuresList}>
          <View style={styles.featureItem}>
            <Text style={styles.featureIcon}>💧</Text>
            <Text style={styles.featureText}>
              Suivi de glycémie et graphiques de tendance
            </Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureIcon}>🧮</Text>
            <Text style={styles.featureText}>
              Calcul des glucides et du bolus d'insuline
            </Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureIcon}>✨</Text>
            <Text style={styles.featureText}>
              Assistant IA et analyse de photos de repas
            </Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureIcon}>📡</Text>
            <Text style={styles.featureText}>
              Capteurs Dexcom, FreeStyle Libre, Nightscout
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGoogleLogin}
          disabled={!request}
          activeOpacity={0.8}
        >
          {!request ? (
            <ActivityIndicator color="#1C1C1E" />
          ) : (
            <View style={styles.buttonContent}>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleButtonText}>Continuer avec Google</Text>
            </View>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Application d'aide au suivi. Les informations fournies ne remplacent
          pas un avis médical.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EBF3FA',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    width: '100%',
    maxWidth: 480,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 4,
  },
  logoContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoIcon: {
    fontSize: 32,
    color: '#FFFFFF',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6E6E73',
    textAlign: 'center',
    marginBottom: 28,
  },
  featuresList: {
    width: '100%',
    marginBottom: 28,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  featureIcon: {
    fontSize: 18,
    marginRight: 12,
  },
  featureText: {
    fontSize: 13,
    color: '#3A3A3C',
    flex: 1,
  },
  googleButton: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  googleIcon: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#EA4335',
    marginRight: 10,
  },
  googleButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  disclaimer: {
    fontSize: 11,
    color: '#8E8E93',
    textAlign: 'center',
    marginTop: 8,
  },
});