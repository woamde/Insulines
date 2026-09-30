import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const storage = {
  async secureSet(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(key, value);
      } else {
        await SecureStore.setItemAsync(key, value);
      }
    } catch (e) {
      console.error(`[Storage] Erreur secureSet (${key}) :`, e);
    }
  },

  async secureGet(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return localStorage.getItem(key);
      }
      return await SecureStore.getItemAsync(key);
    } catch (e) {
      console.error(`[Storage] Erreur secureGet (${key}) :`, e);
      return null;
    }
  },

  async secureDelete(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        localStorage.removeItem(key);
      } else {
        await SecureStore.deleteItemAsync(key);
      }
    } catch (e) {
      console.error(`[Storage] Erreur secureDelete (${key}) :`, e);
    }
  },
};

// Export par défaut au cas où
export default storage;