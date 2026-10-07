import React, { useState, useCallback } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  ActivityIndicator, 
  ScrollView, 
  RefreshControl, 
  TouchableOpacity,
  Dimensions 
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { LineChart } from 'react-native-chart-kit';

const RAW_URL = process.env.EXPO_PUBLIC_API_URL || 'http://192.168.1.140:8002';
const API_BASE_URL = RAW_URL.endsWith('/api') ? RAW_URL.slice(0, -4) : RAW_URL;
const SCREEN_WIDTH = Dimensions.get('window').width;

interface GlycemiaEntry {
  id?: string;
  value: number; // glycémie en mg/dL
  timestamp?: string; // Horodatage ISO ou HH:mm
  insulin_units?: number; // Doses d'insuline
  meal_carbs?: number; // Repas en g de glucides
}

export default function StatsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  const [entries, setEntries] = useState<GlycemiaEntry[]>([]);
  const [stats, setStats] = useState({
    average: 0,
    totalCount: 0,
    min: 0,
    max: 0,
    estimatedHbA1c: 0,
  });

  const fetchStats = async () => {
    try {
      let res = await fetch(`${API_BASE_URL}/api/journal`);
      if (!res.ok) {
        res = await fetch(`${API_BASE_URL}/journal`);
      }

      if (res.ok) {
        const data = await res.json();
        
        if (Array.isArray(data) && data.length > 0) {
          // Normalisation et tri des entrées
          const parsedEntries: GlycemiaEntry[] = data.map((d: any, idx: number) => ({
            id: d.id || String(idx),
            value: d.glucose?.value ?? d.value ?? d.glycemia ?? 0,
            timestamp: d.timestamp || d.created_at || d.time || new Date().toISOString(),
            insulin_units: d.insulin_units ?? d.insulin ?? 0,
            meal_carbs: d.meal_carbs ?? d.carbs ?? 0,
          })).filter((e) => typeof e.value === 'number' && e.value > 0);

          // Tri par ordre chronologique
          parsedEntries.sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime());
          setEntries(parsedEntries);

          const values = parsedEntries.map((e) => e.value);
          if (values.length > 0) {
            const sum = values.reduce((acc, val) => acc + val, 0);
            const avg = Math.round(sum / values.length);
            // Formule ADAG : eA1c (%) = (Moyenne mg/dL + 46.7) / 28.7
            const hba1c = Number(((avg + 46.7) / 28.7).toFixed(1));

            setStats({
              average: avg,
              totalCount: values.length,
              min: Math.min(...values),
              max: Math.max(...values),
              estimatedHbA1c: hba1c,
            });
          }
        } else {
          setStats({ average: 0, totalCount: 0, min: 0, max: 0, estimatedHbA1c: 0 });
          setEntries([]);
        }
      }
    } catch (e) {
      console.error('Erreur chargement statistiques:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const generateAIAnalysis = async () => {
    if (stats.totalCount === 0) return;

    setAiLoading(true);
    setAiAnalysis(null);
    try {
      const recentHistory = entries.slice(-6).map((e) => {
        const timeStr = new Date(e.timestamp!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const insulinStr = e.insulin_units ? ` | 💉 ${e.insulin_units}U insuline` : '';
        const carbStr = e.meal_carbs ? ` | 🍽️ ${e.meal_carbs}g glucides` : '';
        return `- ${timeStr} : ${e.value} mg/dL${insulinStr}${carbStr}`;
      }).join('\n');

      const prompt = `Analyse mes données glycémiques récentes :
- Moyenne : ${stats.average} mg/dL
- HbA1c estimée (eA1c) : ${stats.estimatedHbA1c} %
- Min : ${stats.min} mg/dL / Max : ${stats.max} mg/dL
- Nombre de mesures : ${stats.totalCount}

Dernier historique horodaté :
${recentHistory}

Donne-moi une analyse concise (3 à 4 phrases), structurée et personnalisée sur la stabilité de ma glycémie en tenant compte des repas et des doses d'insuline.`;

      const res = await fetch(`${API_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-3.5-flash-lite',
          message: prompt,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setAiAnalysis(json.reply);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setAiAnalysis(`Impossible d'obtenir l'analyse : ${errJson.detail || res.statusText}`);
      }
    } catch (err) {
      console.error('Erreur appel Gemini:', err);
      setAiAnalysis('Erreur de connexion au serveur IA.');
    } finally {
      setAiLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchStats();
    }, [])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1da1f2" />
        <Text style={styles.loadingText}>Chargement des données...</Text>
      </View>
    );
  }

  // Préparation des données du graphique (7 dernières entrées)
  const recentEntries = entries.slice(-7);
  const chartLabels = recentEntries.map((e) =>
    new Date(e.timestamp!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  const chartData = recentEntries.map((e) => e.value);

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchStats(); }} />
      }
    >
      <Text style={styles.title}>Statistiques & Graphique</Text>

      {/* Carte d'estimation HbA1c */}
      <View style={styles.hba1cCard}>
        <Text style={styles.hba1cTitle}>HbA1c Estimée (eA1c)</Text>
        <Text style={styles.hba1cValue}>
          {stats.estimatedHbA1c ? `${stats.estimatedHbA1c} %` : '-'}
        </Text>
        <Text style={styles.hba1cSubtext}>
          Calculée sur une moyenne de {stats.average} mg/dL ({stats.totalCount} mesures)
        </Text>
      </View>

      {/* Grille des statistiques principales */}
      <View style={styles.grid}>
        <View style={styles.card}>
          <Text style={styles.label}>Moyenne</Text>
          <Text style={styles.value}>{stats.average ? `${stats.average} mg/dL` : '-'}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>Minimum</Text>
          <Text style={styles.value}>{stats.min ? `${stats.min} mg/dL` : '-'}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>Maximum</Text>
          <Text style={styles.value}>{stats.max ? `${stats.max} mg/dL` : '-'}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>Total Mesures</Text>
          <Text style={styles.value}>{stats.totalCount}</Text>
        </View>
      </View>

      {/* Graphique de la glycémie selon l'heure */}
      {chartData.length > 0 && (
        <View style={styles.chartSection}>
          <Text style={styles.sectionTitle}>Évolution Glycémique</Text>
          <LineChart
            data={{
              labels: chartLabels.length > 0 ? chartLabels : ['-'],
              datasets: [{ data: chartData.length > 0 ? chartData : [100] }],
            }}
            width={SCREEN_WIDTH - 40}
            height={220}
            yAxisSuffix=" mg"
            chartConfig={{
              backgroundColor: '#ffffff',
              backgroundGradientFrom: '#ffffff',
              backgroundGradientTo: '#ffffff',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(29, 161, 242, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(101, 119, 134, ${opacity})`,
              style: { borderRadius: 16 },
              propsForDots: {
                r: '5',
                strokeWidth: '2',
                stroke: '#1da1f2',
              },
            }}
            bezier
            style={{ marginVertical: 8, borderRadius: 16 }}
          />

          {/* Liste horodatée détaillée avec insuline & repas */}
          <Text style={styles.sectionTitle}>Détail des Saisies Horodatées</Text>
          {entries.slice(-5).reverse().map((item, index) => (
            <View key={item.id || index} style={styles.timelineItem}>
              <View style={styles.timelineHeader}>
                <Text style={styles.timelineTime}>
                  🕒 {new Date(item.timestamp!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={styles.timelineGlycemia}>{item.value} mg/dL</Text>
              </View>
              <View style={styles.timelineBadges}>
                {item.insulin_units ? (
                  <Text style={styles.badgeInsulin}>💉 {item.insulin_units} U insuline</Text>
                ) : null}
                {item.meal_carbs ? (
                  <Text style={styles.badgeMeal}>🍽️ {item.meal_carbs} g glucides</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Bloc Analyse IA avec Gemini */}
      <View style={styles.aiSection}>
        <TouchableOpacity 
          style={styles.aiButton} 
          onPress={generateAIAnalysis} 
          disabled={aiLoading || stats.totalCount === 0}
        >
          {aiLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.aiButtonText}>✨ Obtenir l'Analyse Gemini IA</Text>
          )}
        </TouchableOpacity>

        {aiAnalysis && (
          <View style={styles.aiCard}>
            <Text style={styles.aiTitle}>Analyse de l'Assistant :</Text>
            <Text style={styles.aiContent}>{aiAnalysis}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: '#657786' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 16, color: '#14171a' },
  hba1cCard: { backgroundColor: '#e8f5fe', padding: 18, borderRadius: 14, marginBottom: 16, alignItems: 'center', borderWidth: 1, borderColor: '#b2dffc' },
  hba1cTitle: { fontSize: 13, color: '#1da1f2', fontWeight: 'bold', textTransform: 'uppercase' },
  hba1cValue: { fontSize: 32, fontWeight: 'bold', color: '#0c85d0', marginVertical: 4 },
  hba1cSubtext: { fontSize: 12, color: '#657786', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  card: { width: '48%', backgroundColor: '#f8f9fa', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#eee' },
  label: { fontSize: 12, color: '#657786' },
  value: { fontSize: 18, fontWeight: 'bold', marginTop: 4, color: '#14171a' },
  chartSection: { marginTop: 10, marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginVertical: 12, color: '#14171a' },
  timelineItem: { backgroundColor: '#f8f9fa', padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#edf2f7' },
  timelineHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  timelineTime: { fontSize: 13, color: '#657786', fontWeight: '500' },
  timelineGlycemia: { fontSize: 15, fontWeight: 'bold', color: '#1da1f2' },
  timelineBadges: { flexDirection: 'row', gap: 8, marginTop: 4 },
  badgeInsulin: { fontSize: 12, backgroundColor: '#ffebee', color: '#c62828', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeMeal: { fontSize: 12, backgroundColor: '#e8f5e9', color: '#2e7d32', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  aiSection: { marginTop: 10, marginBottom: 50 },
  aiButton: { backgroundColor: '#1da1f2', padding: 16, borderRadius: 12, alignItems: 'center' },
  aiButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  aiCard: { marginTop: 16, backgroundColor: '#f0f7ff', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#cce5ff' },
  aiTitle: { fontWeight: 'bold', color: '#004085', marginBottom: 6 },
  aiContent: { color: '#004085', fontSize: 14, lineHeight: 21 }
});