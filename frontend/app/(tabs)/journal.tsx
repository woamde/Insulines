import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, ActivityIndicator } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://127.0.0.1:8002";

const formatDateParis = (dateString: string | Date) => {
  if (!dateString) return '';
  const date = new Date(dateString);

  return date.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export default function JournalScreen() {
  const [readings, setReadings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchJournalData() {
      try {
        setLoading(true);

        // Récupération du token d'authentification stocké
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') || localStorage.getItem('session_token') : '';

        const headers: HeadersInit = {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };

        // Appel direct et sécurisé vers la route des glycémies
        const res = await fetch(`${API_URL}/api/glucose?limit=300`, { headers, credentials: 'include' });

        if (res.ok) {
          const data = await res.json();
          const rawList = Array.isArray(data) ? data : data.readings || data.data || [];

          // Tri décroissant (plus récent au plus ancien)
          const sortedList = [...rawList].sort((a, b) => {
            const dateA = new Date(a.measured_at || a.timestamp || a.date || a.created_at || 0).getTime();
            const dateB = new Date(b.measured_at || b.timestamp || b.date || b.created_at || 0).getTime();
            return dateB - dateA;
          });

          setReadings(sortedList);
        } else {
          setError(`Erreur de chargement de l'historique (${res.status})`);
        }
      } catch (err: any) {
        setError(err.message || "Impossible de charger l'historique");
      } finally {
        setLoading(false);
      }
    }

    fetchJournalData();
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Chargement du journal...</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Journal des glycémies</Text>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {readings.length === 0 && !error ? (
        <View style={styles.center}>
          <Text style={styles.loadingText}>Aucune mesure enregistrée.</Text>
        </View>
      ) : (
        readings.map((item, index) => {
          const rawDate = item.measured_at || item.timestamp || item.date || item.created_at;
          const formattedDate = formatDateParis(rawDate);

          return (
            <View key={index} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.valueText}>{item.value_mgdl ?? item.value ?? '--'} mg/dL</Text>
                <Text style={styles.sourceText}>{item.source || 'libre'}</Text>
              </View>
              <Text style={styles.dateText}>
                {formattedDate || 'Date inconnue'}
              </Text>
              {item.note ? <Text style={styles.noteText}>Note : {item.note}</Text> : null}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#f8f9fa',
    flexGrow: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
    fontSize: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  valueText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  sourceText: {
    fontSize: 12,
    color: '#888',
    backgroundColor: '#f1f3f5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  dateText: {
    fontSize: 13,
    color: '#666',
    marginTop: 6,
  },
  noteText: {
    fontSize: 13,
    color: '#444',
    marginTop: 4,
    fontStyle: 'italic',
  },
  errorBox: {
    backgroundColor: '#ffebee',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: '#c62828',
    textAlign: 'center',
  },
});