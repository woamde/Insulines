import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';

const getApiUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `http://${window.location.hostname}:8002`;
  }
  return "http://127.0.0.1:8002";
};

export default function DashboardScreen() {
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [latestReadings, setLatestReadings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchData() {
    const apiUrl = getApiUrl();
    try {
      setError(null);
      const token = typeof window !== 'undefined' 
        ? localStorage.getItem('token') || localStorage.getItem('session_token') 
        : '';

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };

      const fetchOptions: RequestInit = { headers, mode: 'cors' };

      // Execution parallele sans blocage global
      const [profileRes, statsRes, glucoseRes] = await Promise.allSettled([
        fetch(`${apiUrl}/api/profile`, fetchOptions),
        fetch(`${apiUrl}/api/stats?days=7`, fetchOptions),
        fetch(`${apiUrl}/api/glucose?limit=5`, fetchOptions)
      ]);

      if (profileRes.status === 'fulfilled' && profileRes.value.ok) {
        setProfile(await profileRes.value.json());
      }

      if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
        setStats(await statsRes.value.json());
      }

      if (glucoseRes.status === 'fulfilled' && glucoseRes.value.ok) {
        const glucoseData = await glucoseRes.value.json();
        const items = Array.isArray(glucoseData) ? glucoseData : (glucoseData.readings || []);
        setLatestReadings(items.slice(0, 5));
      }

      if (
        profileRes.status === 'rejected' && 
        statsRes.status === 'rejected' && 
        glucoseRes.status === 'rejected'
      ) {
        setError("Impossible de contacter le serveur backend. Assurez-vous que l'API tourne sur le port 8002.");
      }
    } catch (err: any) {
      setError(`Erreur réseau : ${err.message || "Connexion refusée"}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Chargement de GlycoSoin...</Text>
      </View>
    );
  }

  return (
    <ScrollView 
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Bonjour, {profile?.first_name || 'Patient'}</Text>
        <Text style={styles.subtitle}>Suivi glycémique et insuline</Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Carte des Statistiques */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Statistiques (7 derniers jours)</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats?.average ?? '--'} mg/dL</Text>
            <Text style={styles.statLabel}>Moyenne</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats?.in_range_pct ?? '--'}%</Text>
            <Text style={styles.statLabel}>Dans la cible</Text>
          </View>
        </View>
      </View>

      {/* Section des Dernières Mesures */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Dernières mesures</Text>
      </View>

      {latestReadings.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Aucune mesure récente trouvée.</Text>
        </View>
      ) : (
        latestReadings.map((item, index) => (
          <View key={item.id || item._id || index} style={styles.readingCard}>
            <View style={styles.readingRow}>
              <Text style={styles.readingValue}>
                {item.value_mgdl ?? item.value ?? '--'} <Text style={styles.unitText}>mg/dL</Text>
              </Text>
              <Text style={styles.badge}>{item.source || 'libre'}</Text>
            </View>
            <Text style={styles.readingDate}>
              {item.measured_at ? new Date(item.measured_at).toLocaleString('fr-FR') : 'Date inconnue'}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#f8f9fa', flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  loadingText: { marginTop: 10, color: '#666', fontSize: 16 },
  header: { marginBottom: 20 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#333' },
  subtitle: { fontSize: 14, color: '#666', marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 20, elevation: 3 },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: '#333' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: 'bold', color: '#007AFF' },
  statLabel: { fontSize: 12, color: '#666', marginTop: 4 },
  sectionHeader: { marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  readingCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, elevation: 2 },
  readingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  readingValue: { fontSize: 18, fontWeight: 'bold', color: '#2c3e50' },
  unitText: { fontSize: 12, fontWeight: 'normal', color: '#7f8c8d' },
  badge: { fontSize: 11, color: '#007AFF', backgroundColor: '#eef6ff', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  readingDate: { fontSize: 12, color: '#888', marginTop: 6 },
  emptyCard: { backgroundColor: '#fff', padding: 20, borderRadius: 10, alignItems: 'center' },
  emptyText: { color: '#888' },
  errorBox: { backgroundColor: '#ffebee', padding: 12, borderRadius: 8, marginBottom: 16 },
  errorText: { color: '#c62828', textAlign: 'center' },
});