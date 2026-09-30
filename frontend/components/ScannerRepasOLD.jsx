import React, { useState } from 'react';
import { View, Text, TextInput, Image, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { analyserRepasMobile } from '../services/api.js';

export default function ScannerRepas({ ratioGlucidesActuel = 10, onGlucidesValides }) {
  const [photoUri, setPhotoUri] = useState(null);
  const [loading, setLoading] = useState(false);
  const [glucides, setGlucides] = useState('');
  const [nomPlat, setNomPlat] = useState('');
  const [conseilIA, setConseilIA] = useState('');

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
    try {
      const reponse = await analyserRepasMobile(uri, ratioGlucidesActuel);
      setGlucides(reponse.estimation_glucides_g ? reponse.estimation_glucides_g.toString() : '0');
      setNomPlat(reponse.nom_plat || '');
      setConseilIA(reponse.conseil || reponse.conseil_insuline || '');
    } catch (err) {
      Alert.alert("Erreur d'analyse", err.message || "Impossible d'analyser l'image.");
    } finally {
      setLoading(false);
    }
  };

  // 4. Validation et passage des données au composant parent
  const envoyerAuCalculateur = () => {
    const valeurGlucides = Number.parseFloat(glucides) || 0;
    if (onGlucidesValides) {
      onGlucidesValides({
        nomPlat,
        glucides: valeurGlucides,
        photoUri,
      });
    }
  };

  return (
    <View className="p-4 bg-slate-800 rounded-2xl border border-slate-700 space-y-4 my-2">
      <Text className="text-lg font-bold text-teal-400 text-center">📸 Analyse du Repas par IA</Text>

      <View className="flex-row justify-between space-x-2">
        <TouchableOpacity onPress={prendrePhoto} className="flex-1 bg-teal-600 p-3 rounded-xl items-center">
          <Text className="text-white font-semibold">📷 Appareil Photo</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={choisirGalerie} className="flex-1 bg-slate-700 p-3 rounded-xl items-center">
          <Text className="text-white font-semibold">🖼️ Galerie</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator size="large" color="#2dd4bf" className="my-4" />}

      {photoUri && <Image source={{ uri: photoUri }} className="w-full h-48 rounded-xl my-2" />}

      <View>
        <Text className="text-xs text-slate-400 font-semibold mb-1">Nom du plat identifié</Text>
        <TextInput
          value={nomPlat}
          onChangeText={setNomPlat}
          placeholder="Ex : Poulet, riz et haricots"
          placeholderTextColor="#94a3b8"
          className="bg-slate-900 text-white p-3 rounded-xl border border-slate-700"
        />
      </View>

      <View>
        <Text className="text-xs text-slate-400 font-semibold mb-1">Glucides estimés (g)</Text>
        <TextInput
          value={glucides}
          onChangeText={setGlucides}
          keyboardType="numeric"
          className="bg-slate-900 text-teal-400 font-bold text-2xl p-3 rounded-xl border border-slate-700 text-center"
        />
      </View>

      {conseilIA ? (
        <View className="bg-slate-900/60 p-3 rounded-xl border border-teal-500/30">
          <Text className="text-xs text-slate-300">💡 <Text className="font-semibold text-teal-400">Analyse IA :</Text> {conseilIA}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={envoyerAuCalculateur}
        disabled={!glucides}
        className={`p-4 rounded-xl items-center ${glucides ? 'bg-teal-500' : 'bg-slate-700 opacity-50'}`}
      >
        <Text className="text-slate-950 font-bold text-base">Injecter {glucides || 0} g dans le Bolus</Text>
      </TouchableOpacity>
    </View>
  );
}