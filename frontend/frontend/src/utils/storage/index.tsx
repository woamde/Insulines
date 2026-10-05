import React, { useEffect, useState } from 'react';
import {
  View,
  ActivityIndicator,
  Text,
  StyleSheet,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { storage } from "@/src/utils/storage";

export default function Index() {
  const params = useLocalSearchParams<{ code?: string; state?: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(() => Boolean(params.code && params.state));

  useEffect(() => {
  // On ne déclenche la validation QUE si le code ET le state existent dans l'URL
  if (params.code && params.state) {
    fetch('http://localhost:8002/api/auth/google/callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: params.code,
        id_token: params.code,
        state: params.state, // Transmet la vraie valeur reçue de Google
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Erreur HTTP : ${res.status}`);
        return res.json();
      })
      .then(async (data: { session_token?: string }) => {
        console.log('Connexion réussie !', data);
        if (data.session_token) {
          await storage.secureSet('userToken', data.session_token);
        }
        router.replace('/(tabs)');
      })
      .catch((err: unknown) => {
        console.error('Échec de la validation Google :', err);
        router.replace('/login');
      })
      .finally(() => setLoading(false));
  }
}, [params.code, params.state, router]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={{ marginTop: 12 }}>Validation de la connexion...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text>Connexion réussie</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    padding: 20,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
      },
    }),
  },
});