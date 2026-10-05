import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function GlucoseTrendSummary() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Résumé des tendances</Text>
      <View style={styles.card}>
        <Text style={styles.text}>Analyse des tendances glycémiques en cours...</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f8f9fa',
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  text: {
    fontSize: 14,
    color: '#666',
  },
});