import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  RefreshControl,
  Pressable,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { API_BASE_URL } from '../../src/api';

interface GlucoseData {
  value: number;
  trend_arrow?: string;
}

interface MeasureItem {
  id: string;
  timestamp?: string;
  value?: number;
  glucose?: GlucoseData | null;
  nom_plat?: string;
  glucides?: number;
}

interface ProfileData {
  first_name?: string;
  prenom?: string;
  firstName?: string;
  nom?: string;
  name?: string;
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [profileName, setProfileName] = useState<string>('Abderahim');
  const [lastMeasure, setLastMeasure] = useState<MeasureItem | null>(null);
  const [lastSyncText, setLastSyncText] = useState<string>("à l'instant");
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const getFormattedToday = () => {
    const today = new Date();
    const str = today.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const getGlucoseStatus = (val?: number) => {
    if (!val) return { label: 'Inconnue', color: '#657786', bg: '#f5f8fa' };
    if (val >= 250) return { label: 'Hyperglycémie sévère', color: '#e0245e', bg: '#ffebee' };
    if (val > 180) return { label: 'Hyperglycémie', color: '#f57c00', bg: '#fff3e0' };
    if (val < 70) return { label: 'Hypoglycémie', color: '#d32f2f', bg: '#ffebee' };
    return { label: 'Dans la cible', color: '#17bf63', bg: '#e8f5e9' };
  };

  const loadData = async (controller?: AbortController) => {
    try {
      const signal = controller?.signal;

      // Charger le profil
      let profileRes = await fetch(`${API_BASE_URL}/api/profile`, { signal });
      if (!profileRes.ok) {
        profileRes = await fetch(`${API_BASE_URL}/profile`, { signal });
      }

      if (profileRes.ok) {
        const profileData: ProfileData = await profileRes.json();
        const name =
          profileData.first_name ||
          profileData.prenom ||
          profileData.firstName ||
          profileData.nom ||
          profileData.name;
        if (name) setProfileName(name);
      }

      // Charger la dernière mesure du journal
      let journalRes = await fetch(`${API_BASE_URL}/api/journal?limit=5`, { signal });
      if (!journalRes.ok) {
        journalRes = await fetch(`${API_BASE_URL}/journal?limit=5`, { signal });
      }

      if (journalRes.ok) {
        const journalData: MeasureItem[] = await journalRes.json();
        if (Array.isArray(journalData) && journalData.length > 0) {
          setLastMeasure(journalData[0]);
        }
      }
      setLastSyncText("à l'instant");
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.warn('Chargement accueil avec données locales :', e.message);
      }
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      loadData(controller);
      return () => controller.abort();
    }, [])
  );

  const glucoseValue = lastMeasure?.glucose?.value ?? lastMeasure?.value;
  const statusInfo = getGlucoseStatus(glucoseValue);
  const initialLetter = profileName ? profileName.charAt(0).toUpperCase() : 'A';

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top + 12, 20),
            paddingBottom: Math.max(insets.bottom + 80, 90),
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData();
            }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.innerContainer}>
          {/* En-tête */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <View style={styles.greetingRow}>
                <Text style={styles.greeting}>Bonjour {profileName}</Text>
                <Text style={styles.waveEmoji}>👋</Text>
              </View>
              <Text style={styles.dateSubtitle}>{getFormattedToday()}</Text>
            </View>

            <View style={styles.headerActions}>
              <Pressable
                style={styles.iconCircleButton}
                onPress={() => router.push('/assistant')}
                accessibilityLabel="Coach IA"
              >
                <Ionicons name="sparkles" size={20} color="#0066cc" />
              </Pressable>

              <Pressable
                style={styles.avatarButton}
                onPress={() => router.push('/profil')}
                accessibilityLabel="Mon profil"
              >
                <Text style={styles.avatarText}>{initialLetter}</Text>
              </Pressable>
            </View>
          </View>

          {/* Carte Capteur */}
          <Pressable style={styles.cgmCard} onPress={() => router.push('/cgm')}>
            <View style={styles.cgmIconContainer}>
              <Ionicons name="bluetooth" size={22} color="#0066cc" />
            </View>
            <View style={styles.cgmInfo}>
              <Text style={styles.cgmTitle}>FreeStyle Libre</Text>
              <Text style={styles.cgmSubtitle}>
                Dernière synchro {lastSyncText}
              </Text>
            </View>
            <Pressable
              style={styles.refreshButton}
              onPress={() => {
                setRefreshing(true);
                loadData();
              }}
            >
              <Ionicons name="refresh" size={22} color="#0066cc" />
            </Pressable>
          </Pressable>

          {/* Carte Glycémie Principale */}
          <View style={styles.glucoseCard}>
            <View style={styles.glucoseCardHeader}>
              <Text style={styles.glucoseCardLabel}>Dernière mesure</Text>
              <View style={styles.cgmBadge}>
                <Text style={styles.cgmBadgeText}>FreeStyle Libre</Text>
              </View>
            </View>

            <View style={styles.glucoseMainRow}>
              <Text style={[styles.glucoseValue, { color: statusInfo.color }]}>
                {glucoseValue ?? '--'}
              </Text>
              <View style={styles.glucoseMetaContainer}>
                <Ionicons
                  name="arrow-up-outline"
                  size={24}
                  color={statusInfo.color}
                  style={styles.trendArrow}
                />
                <Text style={[styles.statusText, { color: statusInfo.color }]}>
                  {statusInfo.label}
                </Text>
              </View>
            </View>

            <Text style={styles.glucoseFooterText}>
              mg/dL · Synchro en temps réel
            </Text>
          </View>

          {/* Boutons d'accès rapide */}
          <View style={styles.actionButtonsRow}>
            <Pressable
              style={[styles.actionButton, styles.actionButtonLight]}
              onPress={() => router.push('/journal')}
            >
              <Ionicons name="water" size={20} color="#0284c7" />
              <Text style={styles.actionButtonLightText}>Glycémie</Text>
            </Pressable>

            <Pressable
              style={[styles.actionButton, styles.actionButtonDark]}
              onPress={() => router.push('/bolus')}
            >
              <Ionicons name="calculator" size={20} color="#fff" />
              <Text style={styles.actionButtonDarkText}>Calculer Bolus</Text>
            </Pressable>
          </View>

          {/* Encart Coach IA */}
          <Pressable
            style={styles.aiCard}
            onPress={() => router.push('/assistant')}
          >
            <View style={styles.aiHeader}>
              <View style={styles.aiIconCircle}>
                <Ionicons name="sparkles" size={20} color="#fff" />
              </View>
              <View style={styles.aiTextContainer}>
                <Text style={styles.aiTitle}>
                  Coach IA — Insuline, Repas & Suivi
                </Text>
                <Text style={styles.aiDescription}>
                  Gemini 3.5 Flash Lite analyse vos mesures glycémiques pour vous donner un bilan synthétique.
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      </ScrollView>

      {/* Bouton Flottant (+) */}
      <Pressable
        style={styles.fab}
        onPress={() => router.push('/journal')}
        accessibilityLabel="Ajouter une mesure"
      >
        <Ionicons name="add" size={32} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  innerContainer: {
    width: '100%',
    maxWidth: 500,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  headerTitleContainer: {
    flex: 1,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  waveEmoji: {
    fontSize: 24,
  },
  dateSubtitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0369a1',
  },
  cgmCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cgmIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cgmInfo: {
    flex: 1,
  },
  cgmTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  cgmSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  refreshButton: {
    padding: 8,
  },
  glucoseCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  glucoseCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  glucoseCardLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#475569',
  },
  cgmBadge: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  cgmBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0284c7',
  },
  glucoseMainRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    marginVertical: 12,
  },
  glucoseValue: {
    fontSize: 68,
    fontWeight: '800',
    lineHeight: 72,
  },
  glucoseMetaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendArrow: {
    transform: [{ rotate: '45deg' }],
  },
  statusText: {
    fontSize: 15,
    fontWeight: '700',
  },
  glucoseFooterText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748b',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  actionButtonLight: {
    backgroundColor: '#e0f2fe',
  },
  actionButtonLightText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0284c7',
  },
  actionButtonDark: {
    backgroundColor: '#0284c7',
  },
  actionButtonDarkText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  aiCard: {
    backgroundColor: '#e0f2fe',
    borderRadius: 20,
    padding: 18,
  },
  aiHeader: {
    flexDirection: 'row',
    gap: 14,
  },
  aiIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0284c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiTextContainer: {
    flex: 1,
  },
  aiTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0369a1',
    marginBottom: 4,
  },
  aiDescription: {
    fontSize: 13,
    color: '#0284c7',
    lineHeight: 18,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#0284c7',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
});