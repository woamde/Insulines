// app/(tabs)/_layout.tsx
import React, { useState } from 'react';
import { Tabs } from 'expo-router';
import { TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

export default function TabLayout() {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);

  const showNotification = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title} : ${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const syncUrl = Platform.OS === 'web' ? '/api/cgm/sync' : 'http://localhost:8000/api/cgm/sync';

      const response = await fetch(syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        await queryClient.invalidateQueries();
        showNotification('Synchronisation', 'Données du capteur actualisées avec succès.');
      } else {
        showNotification('Erreur', `Échec de la synchronisation (Code ${response.status}).`);
      }
    } catch (error) {
      showNotification('Erreur', 'Impossible de contacter le serveur backend.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#0284c7',
        tabBarInactiveTintColor: '#64748b',
        headerStyle: { backgroundColor: '#ffffff' },
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          headerRight: () => (
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={handleSync}
              disabled={isSyncing}
              activeOpacity={0.5}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color="#0284c7" />
              ) : (
                <Ionicons name="refresh-outline" size={24} color="#0284c7" />
              )}
            </TouchableOpacity>
          ),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size || 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calculateur"
        options={{
          title: 'Suivi',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard-outline" size={size || 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          title: 'Journal',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="book-outline" size={size || 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart-outline" size={size || 22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  refreshButton: {
    marginRight: 16,
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});