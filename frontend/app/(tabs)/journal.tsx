import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://127.0.0.1:8002";

const formatDateParis = (dateString: string | Date) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
};

const INSULIN_LABELS: Record<string, string> = {
  basale: 'Insuline basale (lente)',
  bolus: 'Bolus (rapide)',
  correction: 'Correction',
  repas: 'Bolus (repas)',
};

type SelectedItem = { id: string | number; type: 'glucose' | 'insulin' };

export default function JournalScreen() {
  const [journalItems, setJournalItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Nouvel état pour gérer la sélection multiple
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

  const fetchJournalData = async () => {
    try {
      setLoading(true);
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') || localStorage.getItem('session_token') : '';
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };

      const [glucoseRes, insulinRes] = await Promise.all([
        fetch(`${API_URL}/api/glucose?limit=300`, { headers, credentials: 'include' }).catch(() => null),
        fetch(`${API_URL}/api/insulin?limit=300`, { headers, credentials: 'include' }).catch(() => null)
      ]);

      let glucoseList = [];
      if (glucoseRes && glucoseRes.ok) {
        const data = await glucoseRes.json();
        glucoseList = Array.isArray(data) ? data : data.readings || data.data || [];
      }

      let insulinList = [];
      if (insulinRes && insulinRes.ok) {
        const data = await insulinRes.json();
        insulinList = Array.isArray(data) ? data : data.readings || data.data || [];
      }

      const TIME_WINDOW_MS = 15 * 60 * 1000;
      const usedInsulinIds = new Set();

      const pairedGlucoseItems = glucoseList.map((glucose: any) => {
        const gTime = new Date(glucose.measured_at || glucose.timestamp || glucose.date || glucose.created_at || 0).getTime();
        const matchingInsulins = insulinList.filter((insulin: any) => {
          const iId = insulin.id ?? insulin._id ?? insulin.uuid;
          if (usedInsulinIds.has(iId)) return false;
          const iTime = new Date(insulin.injected_at || insulin.timestamp || insulin.date || insulin.created_at || 0).getTime();
          return Math.abs(gTime - iTime) <= TIME_WINDOW_MS;
        });

        matchingInsulins.forEach((ins: any) => usedInsulinIds.add(ins.id ?? ins._id ?? ins.uuid));
        return { type: 'glucose_group', timestamp: gTime, glucose, insulins: matchingInsulins };
      });

      const remainingInsulins = insulinList
        .filter((insulin: any) => !usedInsulinIds.has(insulin.id ?? insulin._id ?? insulin.uuid))
        .map((insulin: any) => ({
          type: 'insulin_standalone',
          timestamp: new Date(insulin.injected_at || insulin.timestamp || insulin.date || insulin.created_at || 0).getTime(),
          insulin,
        }));

      const combined = [...pairedGlucoseItems, ...remainingInsulins].sort((a, b) => b.timestamp - a.timestamp);
      setJournalItems(combined);
      setSelectedItems([]); // Réinitialiser la sélection au rafraîchissement
    } catch (err: any) {
      setError(err.message || "Impossible de charger l'historique");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJournalData();
  }, []);

  // Gérer le coche/décoche
  const toggleSelection = (id: string | number, type: 'glucose' | 'insulin') => {
    setSelectedItems(prev => {
      const exists = prev.find(item => item.id === id && item.type === type);
      if (exists) {
        return prev.filter(item => !(item.id === id && item.type === type)); // Retire si déjà coché
      } else {
        return [...prev, { id, type }]; // Ajoute sinon
      }
    });
  };

  const isSelected = (id: string | number, type: 'glucose' | 'insulin') => {
    return selectedItems.some(item => item.id === id && item.type === type);
  };

  // Suppression d'un seul élément
  const handleDeleteEntry = async (id: number | string, endpointType: 'glucose' | 'insulin') => {
    if (!window.confirm("Voulez-vous vraiment supprimer cette entrée ?")) return;
    await executeDelete(id, endpointType);
    fetchJournalData();
  };

  // Suppression par lots
  const handleBatchDelete = async () => {
    if (selectedItems.length === 0) return;
    if (!window.confirm(`Voulez-vous vraiment supprimer les ${selectedItems.length} entrées sélectionnées ?`)) return;

    setLoading(true);
    let successCount = 0;
    let errorCount = 0;

    // Exécuter toutes les requêtes de suppression en parallèle
    await Promise.all(selectedItems.map(async (item) => {
      const success = await executeDelete(item.id, item.type, true);
      if (success) successCount++;
      else errorCount++;
    }));

    alert(`Suppression terminée.\nSuccès : ${successCount}\nÉchecs : ${errorCount}`);
    fetchJournalData();
  };

  // Fonction centrale pour appeler l'API DELETE
  const executeDelete = async (id: number | string, endpointType: 'glucose' | 'insulin', silent = false) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') || localStorage.getItem('session_token') : '';
    const headers: HeadersInit = { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) };
    
    const primaryPath = `${API_URL}/api/${endpointType}/${id}`;
    const pluralType = endpointType === 'glucose' ? 'glucoses' : 'insulins';
    const secondaryPath = `${API_URL}/api/${pluralType}/${id}`;

    try {
      let res = await fetch(primaryPath, { method: 'DELETE', headers, credentials: 'include' });
      if (res.status === 404) {
        res = await fetch(secondaryPath, { method: 'DELETE', headers, credentials: 'include' });
      }

      if (res.ok) return true;
      if (!silent) alert(`Erreur (${res.status}) lors de la suppression.`);
      return false;
    } catch (err) {
      if (!silent) alert('Impossible de joindre le serveur.');
      return false;
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Chargement du journal...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      
      {/* BARRE D'ACTIONS MULTIPLES (Apparaît si éléments cochés) */}
      {selectedItems.length > 0 && (
        <View style={styles.batchActionBar}>
          <Text style={styles.batchActionText}>{selectedItems.length} élément(s) sélectionné(s)</Text>
          <View style={styles.batchActionButtons}>
            <TouchableOpacity style={styles.cancelBatchButton} onPress={() => setSelectedItems([])}>
              <Text style={styles.cancelBatchText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBatchButton} onPress={handleBatchDelete}>
              <Text style={styles.deleteBatchText}>🗑️ Tout supprimer</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Journal de suivi</Text>
        </View>

        {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

        {journalItems.length === 0 && !error ? (
          <View style={styles.center}><Text style={styles.loadingText}>Aucune donnée enregistrée.</Text></View>
        ) : (
          journalItems.map((item, index) => {
            if (item.type === 'glucose_group') {
              const g = item.glucose;
              const gId = g.id ?? g._id ?? g.uuid;
              const formattedDate = formatDateParis(g.measured_at || g.timestamp || g.date || g.created_at);

              return (
                <View key={index} style={[styles.card, isSelected(gId, 'glucose') && styles.cardSelected]}>
                  <View style={styles.row}>
                    <View style={styles.selectionRow}>
                      {gId && (
                        <TouchableOpacity onPress={() => toggleSelection(gId, 'glucose')} style={styles.checkbox}>
                          {isSelected(gId, 'glucose') && <Text style={styles.checkMark}>✓</Text>}
                        </TouchableOpacity>
                      )}
                      <Text style={styles.valueText}>{g.value_mgdl ?? g.value ?? '--'} mg/dL</Text>
                    </View>
                    <View style={styles.actionsRow}>
                      <Text style={styles.sourceText}>{g.source || 'libre'}</Text>
                    </View>
                  </View>
                  <Text style={styles.dateText}>{formattedDate || 'Date inconnue'}</Text>
                  {g.note ? <Text style={styles.noteText}>Note : {g.note}</Text> : null}

                  {item.insulins.length > 0 && (
                    <View style={styles.subInsulinContainer}>
                      {item.insulins.map((ins: any, insIdx: number) => {
                        const insId = ins.id ?? ins._id ?? ins.uuid;
                        const kindLabel = INSULIN_LABELS[ins.kind] || ins.kind || 'Insuline';
                        return (
                          <View key={insIdx} style={[styles.subInsulinRow, isSelected(insId, 'insulin') && styles.subCardSelected]}>
                            <View style={styles.row}>
                              <View style={styles.selectionRow}>
                                {insId && (
                                  <TouchableOpacity onPress={() => toggleSelection(insId, 'insulin')} style={styles.checkboxSmall}>
                                    {isSelected(insId, 'insulin') && <Text style={styles.checkMarkSmall}>✓</Text>}
                                  </TouchableOpacity>
                                )}
                                <View style={styles.insulinBadgeContainer}>
                                  <Text style={styles.insulinBadgeText}>💉 {ins.units} U</Text>
                                  <Text style={styles.insulinTypeLabel}>({kindLabel})</Text>
                                </View>
                              </View>
                            </View>
                            {ins.note ? <Text style={styles.subNoteText}>{ins.note}</Text> : null}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            }

            if (item.type === 'insulin_standalone') {
              const ins = item.insulin;
              const insId = ins.id ?? ins._id ?? ins.uuid;
              const formattedDate = formatDateParis(ins.injected_at || ins.timestamp || ins.date || ins.created_at);
              const kindLabel = INSULIN_LABELS[ins.kind] || ins.kind || 'Insuline';

              return (
                <View key={index} style={[styles.card, styles.insulinCard, isSelected(insId, 'insulin') && styles.cardSelected]}>
                  <View style={styles.row}>
                    <View style={styles.selectionRow}>
                      {insId && (
                        <TouchableOpacity onPress={() => toggleSelection(insId, 'insulin')} style={styles.checkbox}>
                          {isSelected(insId, 'insulin') && <Text style={styles.checkMark}>✓</Text>}
                        </TouchableOpacity>
                      )}
                      <Text style={styles.insulinValueText}>{ins.units} U</Text>
                    </View>
                    <View style={styles.actionsRow}>
                      <Text style={styles.insulinBadge}>{kindLabel}</Text>
                    </View>
                  </View>
                  <Text style={styles.dateText}>{formattedDate || 'Date inconnue'}</Text>
                  {ins.note ? <Text style={styles.noteText}>Note : {ins.note}</Text> : null}
                </View>
              );
            }
            return null;
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 10, color: '#666', fontSize: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  
  // Styles pour la barre de suppression en lot
  batchActionBar: { backgroundColor: '#333', padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 },
  batchActionText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  batchActionButtons: { flexDirection: 'row', gap: 12 },
  cancelBatchButton: { backgroundColor: '#555', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  cancelBatchText: { color: '#fff', fontWeight: 'bold' },
  deleteBatchButton: { backgroundColor: '#ef4444', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  deleteBatchText: { color: '#fff', fontWeight: 'bold' },

  // Styles des cases à cocher
  selectionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderColor: '#007AFF', borderRadius: 4, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  checkMark: { color: '#007AFF', fontWeight: 'bold', fontSize: 16 },
  checkboxSmall: { width: 20, height: 20, borderWidth: 2, borderColor: '#7c3aed', borderRadius: 4, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  checkMarkSmall: { color: '#7c3aed', fontWeight: 'bold', fontSize: 14 },
  
  // Effets visuels quand sélectionné
  cardSelected: { borderColor: '#007AFF', borderWidth: 2, backgroundColor: '#f0f7ff' },
  subCardSelected: { borderColor: '#7c3aed', borderWidth: 1, backgroundColor: '#f3e8ff' },

  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, borderWidth: 2, borderColor: 'transparent' },
  insulinCard: { borderLeftWidth: 4, borderLeftColor: '#8b5cf6' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  valueText: { fontSize: 20, fontWeight: 'bold', color: '#007AFF' },
  insulinValueText: { fontSize: 20, fontWeight: 'bold', color: '#8b5cf6' },
  sourceText: { fontSize: 12, color: '#888', backgroundColor: '#f1f3f5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  insulinBadge: { fontSize: 12, color: '#6d28d9', backgroundColor: '#ede9fe', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, fontWeight: '600' },
  dateText: { fontSize: 13, color: '#666', marginTop: 6, paddingLeft: 36 },
  noteText: { fontSize: 13, color: '#444', marginTop: 4, fontStyle: 'italic', paddingLeft: 36 },
  
  subInsulinContainer: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f3f5' },
  subInsulinRow: { backgroundColor: '#f5f3ff', padding: 10, borderRadius: 8, marginTop: 6 },
  insulinBadgeContainer: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  insulinBadgeText: { fontSize: 15, fontWeight: 'bold', color: '#7c3aed' },
  insulinTypeLabel: { fontSize: 13, color: '#6d28d9', fontWeight: '500' },
  subNoteText: { fontSize: 12, color: '#6b7280', marginTop: 4, fontStyle: 'italic', paddingLeft: 32 },
  
  errorBox: { backgroundColor: '#ffebee', padding: 12, borderRadius: 8, marginBottom: 16 },
  errorText: { color: '#c62828', textAlign: 'center' },
});