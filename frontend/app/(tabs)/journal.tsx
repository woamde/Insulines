import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { API_BASE_URL } from '../../src/api';

export default function JournalScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchJournal = async () => {
    try {
      // Normalisation de l'URL pour éviter la duplication /api/api
      const baseUrl = API_BASE_URL.replace(/\/+$/, '');
      const url = baseUrl.endsWith('/api') ? `${baseUrl}/journal` : `${baseUrl}/api/journal`;

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : []);
      } else {
        setItems([]);
      }
    } catch (e) {
      console.warn('Erreur chargement journal :', e);
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Déclenchement au chargement initial de la page (Navigateur Web)
  useEffect(() => {
    fetchJournal();
  }, []);

  // Déclenchement à la sélection de l'onglet dans Expo
  useFocusEffect(
    useCallback(() => {
      fetchJournal();
    }, [])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={styles.loadingText}>Chargement du journal...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Journal d'entrées</Text>

      <FlatList
        data={items}
        keyExtractor={(item, index) => item.id?.toString() || index.toString()}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={() => { 
              setRefreshing(true); 
              fetchJournal(); 
            }} 
            colors={["#0284c7"]}
          />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>Aucune donnée enregistrée dans le journal.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.date}>
              {item.timestamp ? new Date(item.timestamp).toLocaleString('fr-FR', {
                weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
              }) : 'Date inconnue'}
            </Text>
            
            <View style={styles.row}>
              {/* Glycémie */}
              {(item.glucose?.value || item.value) && (
                <Text style={styles.glucose}>{item.glucose?.value || item.value} mg/dL</Text>
              )}
              
              {/* Insuline */}
              {item.insulin_units ? (
                <Text style={styles.insulin}>{item.insulin_units} U</Text>
              ) : null}
              
              {/* Glucides */}
              {item.meal_carbs ? (
                <Text style={styles.carbs}>{item.meal_carbs} g</Text>
              ) : null}
            </View>

            {/* Notes */}
            {item.notes ? (
              <Text style={styles.notes}>{item.notes}</Text>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#f8fafc', 
    padding: 20, 
    paddingTop: 60 
  },
  center: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: '#f8fafc'
  },
  loadingText: { 
    marginTop: 12, 
    color: '#64748b' 
  },
  title: { 
    fontSize: 28, 
    fontWeight: 'bold', 
    marginBottom: 20,
    color: '#0f172a'
  },
  emptyText: { 
    textAlign: 'center', 
    color: '#64748b', 
    marginTop: 40,
    fontSize: 15
  },
  card: { 
    padding: 16, 
    backgroundColor: '#ffffff', 
    borderRadius: 16, 
    marginBottom: 12, 
    borderWidth: 1, 
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  date: { 
    fontSize: 13, 
    color: '#64748b', 
    marginBottom: 10,
    fontWeight: '500',
    textTransform: 'capitalize'
  },
  row: { 
    flexDirection: 'row', 
    gap: 16,
    alignItems: 'center'
  },
  glucose: { 
    fontSize: 20, 
    fontWeight: '800', 
    color: '#0284c7' 
  },
  insulin: { 
    fontSize: 16, 
    fontWeight: '700', 
    color: '#e11d48',
    backgroundColor: '#ffe4e6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden'
  },
  carbs: {
    fontSize: 16, 
    fontWeight: '700', 
    color: '#16a34a',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden'
  },
  notes: {
    marginTop: 10,
    fontSize: 14,
    color: '#475569',
    fontStyle: 'italic'
  }
});