import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useProfile, useStats } from '@/src/api';

const API_URL = 'http://127.0.0.1:8000/api/journal';

export default function HomeScreen() {
  const router = useRouter();
  
  const { data: profile, refetch: refetchProfile } = useProfile();
  const { data: stats, refetch: refetchStats } = useStats(7);

  const [journalEntries, setJournalEntries] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchJournal = async () => {
    try {
      const response = await fetch(API_URL);
      
      if (!response.ok) {
        throw new Error(`Le serveur a répondu avec le statut ${response.status}`);
      }

      const data = await response.json();
      if (Array.isArray(data)) {
        setJournalEntries(data);
      }
    } catch (error) {
      console.error("Erreur lors de la récupération du journal :", error);
    }
  };

  useFocusEffect(
    useCallback(() => {
      refetchProfile();
      refetchStats();
      fetchJournal();
    }, [refetchProfile, refetchStats])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchProfile(), refetchStats(), fetchJournal()]);
    setRefreshing(false);
  };

  const username = profile?.name || profile?.first_name || profile?.username || 'Patient';

  const formatParisTime = (timestamp?: string) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const getGlucoseColor = (value: number | string) => {
    const num = Number(value);
    if (isNaN(num)) return '#1C1C1E'; 
    if (num < 70) return '#EAB308';   
    if (num > 180) return '#EF4444';  
    return '#22C55E';                 
  };

  // Nouvelle fonction pour le thème de l'insuline
  const getInsulinTheme = (kind?: string) => {
    const k = (kind || 'bolus').toLowerCase();
    
    // Humalog / Rapide / Bolus -> Lie de vin
    if (k.includes('humalog') || k.includes('bolus') || k.includes('rapide')) {
      return { 
        text: '#800020', // Code couleur classique Lie de vin / Burgundy
        bg: '#F5E6E8'    // Fond lie de vin très clair pour le badge
      };
    }
    
    // Toujeo / Lente / Basal -> Vert pâle
    if (k.includes('toujeo') || k.includes('basal') || k.includes('lente')) {
      return { 
        text: '#276749', // Vert sapin pour un texte bien lisible
        bg: '#D1F2D3'    // Vert pâle pour le badge
      };
    }

    // Par défaut (orange)
    return { text: '#D97706', bg: '#FEF3C7' }; 
  };

  return (
    <ScrollView 
      style={styles.container} 
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Bonjour, {username}</Text>
          <Text style={styles.subtitle}>Suivi glycémique et insuline unifié</Text>
        </View>

        <TouchableOpacity 
          style={styles.syncButton} 
          onPress={() => router.push('/profil')}
          activeOpacity={0.8}
        >
          <Text style={styles.syncButtonText}>Mon Profil</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsCard}>
        <Text style={styles.sectionTitle}>Statistiques (7 derniers jours)</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>
              {stats?.avg ? `${Math.round(stats.avg)} mg/dL` : '—'}
            </Text>
            <Text style={styles.statLabel}>Moyenne</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>
              {stats?.tir !== undefined ? `${Math.round(stats.tir)}%` : '--%'}
            </Text>
            <Text style={styles.statLabel}>Dans la cible</Text>
          </View>
        </View>
      </View>

      <Text style={styles.sectionTitleHeader}>Dernières mesures</Text>
      
      {journalEntries.length > 0 ? (
        journalEntries.slice(0, 30).map((item: any, index: number) => {
          const formattedDate = formatParisTime(item.timestamp);
          // On génère le thème de l'insuline pour cette entrée
          const insulinTheme = item.insulin ? getInsulinTheme(item.insulin.kind) : null;

          return (
            <View key={item.id || index} style={styles.measureCard}>
              <View style={styles.cardHeaderRow}>
                {formattedDate ? (
                  <Text style={styles.measureDate}>{formattedDate}</Text>
                ) : null}
                {item.note ? (
                  <Text style={styles.noteText} numberOfLines={1}>Note : {item.note}</Text>
                ) : null}
              </View>

              <View style={styles.inlineDetails}>
                {item.glucose ? (
                  <View style={styles.glucoseSection}>
                    <Text 
                      style={[
                        styles.measureValue, 
                        { color: getGlucoseColor(item.glucose.value) }
                      ]}
                    >
                      📊 {item.glucose.value} <Text style={styles.unit}>{item.glucose.unit || 'mg/dL'}</Text>
                    </Text>
                    <Text style={styles.badge}>{item.glucose.source || 'manuel'}</Text>
                  </View>
                ) : null}

                {item.insulin && insulinTheme ? (
                  <View style={styles.insulinSection}>
                    <Text style={[styles.insulinValue, { color: insulinTheme.text }]}>
                      💉 {item.insulin.units} <Text style={styles.unit}>U</Text>
                    </Text>
                    <Text style={[
                      styles.insulinBadge, 
                      { backgroundColor: insulinTheme.bg, color: insulinTheme.text }
                    ]}>
                      {item.insulin.kind || 'bolus'}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })
      ) : (
        <View style={styles.centerBox}>
          <Text style={styles.emptyText}>Aucune mesure trouvée dans le journal.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  greeting: { fontSize: 26, fontWeight: 'bold', color: '#1C1C1E' },
  subtitle: { fontSize: 14, color: '#6E6E73', marginTop: 2 },
  syncButton: { backgroundColor: '#007AFF', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  syncButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  statsCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 24, elevation: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#3A3A3C', marginBottom: 16 },
  sectionTitleHeader: { fontSize: 18, fontWeight: 'bold', color: '#1C1C1E', marginBottom: 12 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statBox: { alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: 'bold', color: '#007AFF' },
  statLabel: { fontSize: 12, color: '#8E8E93', marginTop: 4 },
  measureCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, marginBottom: 10, elevation: 1 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  measureDate: { fontSize: 12, color: '#8E8E93' },
  noteText: { fontSize: 12, color: '#555', fontStyle: 'italic', maxWidth: '50%' },
  inlineDetails: { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', marginTop: 4, gap: 20, flexWrap: 'wrap' },
  glucoseSection: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  insulinSection: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  measureValue: { fontSize: 18, fontWeight: 'bold' },
  insulinValue: { fontSize: 18, fontWeight: 'bold' }, // La couleur est maintenant dynamique
  unit: { fontSize: 12, fontWeight: 'normal', color: '#8E8E93' },
  badge: { backgroundColor: '#E8F2FF', color: '#007AFF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, fontSize: 12, overflow: 'hidden' },
  insulinBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, fontSize: 12, overflow: 'hidden' }, // Les couleurs sont maintenant dynamiques
  centerBox: { marginTop: 30, alignItems: 'center' },
  emptyText: { color: '#8E8E93', fontSize: 14 },
});