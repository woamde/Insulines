import React, { useState } from 'react';
import { View, Text, TextInput, Image, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@react-native-vector-icons/ionicons';

import { makeStyles, useTheme } from '@/src/theme';
import { ErrorState } from '@/src/components/ui';
import { analyserRepasMobile } from '../services/api.js';

export default function ScannerRepas({ ratioGlucidesActuel = 10, onGlucidesValides }) {
  const { colors } = useTheme();
  const styles = useStyles();

  const [photoUri, setPhotoUri] = useState(null);
  const [loading, setLoading] = useState(false);
  const [glucides, setGlucides] = useState('');
  const [nomPlat, setNomPlat] = useState('');
  const [conseilIA, setConseilIA] = useState('');
  const [erreurAnalyse, setErreurAnalyse] = useState(null);

  // 1. Prise de vue via appareil photo
  const prendrePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission requise', 'Accès à la caméra nécessaire.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0].uri) {
      traiterImage(result.assets[0].uri);
    }
  };

  // 2. Sélection via la galerie
  const choisirGalerie = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission requise', 'Accès à la galerie nécessaire.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0].uri) {
      traiterImage(result.assets[0].uri);
    }
  };

  // 3. Traitement et envoi vers le serveur d'analyse
  const traiterImage = async (uri) => {
    setPhotoUri(uri);
    setLoading(true);
    setErreurAnalyse(null);
    try {
      const reponse = await analyserRepasMobile(uri, ratioGlucidesActuel);
      setGlucides(reponse.estimation_glucides_g != null ? reponse.estimation_glucides_g.toString() : '0');
      setNomPlat(reponse.nom_plat || '');
      setConseilIA(reponse.conseil || reponse.conseil_insuline || '');
    } catch (err) {
      // On ne connaît pas la forme exacte de l'erreur renvoyée par services/api.js :
      // ce test reste au mieux, mais dans tous les cas on n'affiche plus jamais le texte brut.
      const brut = String(err?.message || '');
      const surcharge = /503|UNAVAILABLE|high demand/i.test(brut);
      setErreurAnalyse(
        surcharge
          ? "Le service d'analyse est momentanément surchargé. Réessayez dans quelques instants, ou complétez les champs ci-dessous à la main."
          : "L'analyse a échoué. Réessayez, ou complétez les champs ci-dessous à la main."
      );
    } finally {
      setLoading(false);
    }
  };

  // 4. Validation et passage des données au composant parent
  const envoyerAuCalculateur = () => {
    const valeurGlucides = Number.parseFloat(glucides) || 0;
    if (onGlucidesValides) {
      onGlucidesValides({ nomPlat, glucides: valeurGlucides, photoUri });
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Analyse du repas par IA</Text>

      <View style={styles.row}>
        <TouchableOpacity onPress={prendrePhoto} style={[styles.actionBtn, styles.actionBtnPrimary]}>
          <Ionicons name="camera" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.actionBtnPrimaryText}>Appareil photo</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={choisirGalerie} style={[styles.actionBtn, styles.actionBtnSecondary]}>
          <Ionicons name="images" size={18} color={colors.onSurface} />
          <Text style={styles.actionBtnSecondaryText}>Galerie</Text>
        </TouchableOpacity>
      </View>

      {loading ? <ActivityIndicator size="large" color={colors.brandPrimary} style={styles.loader} /> : null}

      {photoUri && !loading ? <Image source={{ uri: photoUri }} style={styles.photo} /> : null}

      {erreurAnalyse && !loading ? (
        <ErrorState message={erreurAnalyse} onRetry={() => traiterImage(photoUri)} />
      ) : null}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Nom du plat identifié</Text>
        <TextInput
          value={nomPlat}
          onChangeText={setNomPlat}
          placeholder="Ex : Poulet, riz et haricots"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Glucides estimés (g)</Text>
        <TextInput
          value={glucides}
          onChangeText={setGlucides}
          keyboardType="numeric"
          style={styles.inputGlucides}
        />
      </View>

      {conseilIA ? (
        <View style={styles.adviceBox}>
          <Text style={styles.adviceText}>
            <Text style={styles.adviceLabel}>Analyse IA : </Text>
            {conseilIA}
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={envoyerAuCalculateur}
        disabled={!glucides}
        style={[styles.submitBtn, !glucides ? styles.submitBtnDisabled : null]}
      >
        <Text style={styles.submitBtnText}>Injecter {glucides || 0} g dans le bolus</Text>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    marginVertical: 8,
    gap: 12,
  },
  title: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  actionBtnPrimary: {
    backgroundColor: colors.brandPrimary,
  },
  actionBtnPrimaryText: {
    color: colors.onBrandPrimary,
    fontWeight: '500',
  },
  actionBtnSecondary: {
    backgroundColor: colors.surfaceTertiary,
  },
  actionBtnSecondaryText: {
    color: colors.onSurface,
    fontWeight: '500',
  },
  loader: {
    marginVertical: 8,
  },
  photo: {
    width: '100%',
    height: 180,
    borderRadius: 12,
  },
  field: {
    gap: 4,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '500',
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.onSurface,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  inputGlucides: {
    backgroundColor: colors.surface,
    color: colors.brandPrimary,
    fontWeight: '500',
    fontSize: 22,
    textAlign: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  adviceBox: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 12,
    padding: 12,
  },
  adviceText: {
    color: colors.onBrandTertiary,
    fontSize: 13,
  },
  adviceLabel: {
    fontWeight: '500',
  },
  submitBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: colors.onBrandPrimary,
    fontWeight: '500',
    fontSize: 15,
  },
}));
