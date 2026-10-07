import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const TOKEN_KEY = 'user_token';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8002/api';

// --- Stockage du Token ---

export const saveToken = async (token: string): Promise<void> => {
  if (Platform.OS === 'web') {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch (error) {
      console.error('Erreur localStorage :', error);
    }
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
};

export const getToken = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (error) {
      return null;
    }
  } else {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  }
};

export const removeToken = async (): Promise<void> => {
  if (Platform.OS === 'web') {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      console.error('Erreur suppression localStorage :', error);
    }
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
};

// --- Client HTTP ---

export const apiFetch = async (endpoint: string, options: RequestInit = {}): Promise<any> => {
  const token = await getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const cleanBase = API_BASE_URL.replace(/\/$/, '');
  const cleanEndpoint = endpoint.replace(/^\//, '');
  const url = `${cleanBase}/${cleanEndpoint}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail || data.message || `Erreur serveur (${response.status})`);
  }

  return data;
};

// --- Profil Utilisateur ---

export const fetchUserProfile = async () => apiFetch('/user/profile');

export const updateUserProfile = async (data: any) =>
  apiFetch('/user/profile', { method: 'PUT', body: JSON.stringify(data) });

export const useProfile = () =>
  useQuery({ queryKey: ['userProfile'], queryFn: fetchUserProfile });

export const useSaveProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUserProfile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['userProfile'] }),
  });
};

// --- CGM / LibreLinkUp ---

export const testCgmConnection = async (credentials: { email: string; password: string }) => {
  return await apiFetch('/cgm/test', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
};

export const saveCgmConfig = async (credentials: { email: string; password: string }) => {
  return await apiFetch('/cgm/settings', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
};

export const saveCgmSettings = saveCgmConfig;

export const useTestCgm = () => useMutation({ mutationFn: testCgmConnection });
export const useSaveCgm = () => useMutation({ mutationFn: saveCgmConfig });

// Export par défaut de sécurité
const api = {
  saveToken,
  getToken,
  removeToken,
  apiFetch,
  fetchUserProfile,
  updateUserProfile,
  useProfile,
  useSaveProfile,
  testCgmConnection,
  saveCgmConfig,
  saveCgmSettings,
  useTestCgm,
  useSaveCgm,
};

export default api;