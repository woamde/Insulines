import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, LogBox, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { ToastProvider } from "@/src/components/Toast";
import { AuthProvider, useAuth } from "@/src/auth";
import { setUnauthorizedHandler } from "@/src/api";
import { queryClient } from "@/src/query-client";
import { useTheme } from "@/src/theme";
import { WebAppShell } from "@/src/components/WebAppShell";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true)

function RootNavigator() {
  const { user, loading, signOut } = useAuth();
  const { colors } = useTheme();

  useEffect(() => {
    setUnauthorizedHandler(() => signOut());
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  // Routes protégées de façon déclarative : sans session Google, seul /login est accessible
  // (plus fiable qu'une redirection dans un effet, qui pouvait être ignorée sur Expo Go).
  const signedIn = user != null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !user?.account_deletion_pending}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profil" />
        <Stack.Screen name="assistant" />
        <Stack.Screen name="coach" />
        <Stack.Screen name="cgm" />
        <Stack.Screen name="rappels" />
        <Stack.Screen name="partage" />
        <Stack.Screen name="import-libreview" />
        <Stack.Screen name="ajouter-glycemie" options={{ presentation: "modal" }} />
        <Stack.Screen name="ajouter-repas" options={{ presentation: "modal" }} />
        <Stack.Screen name="ajouter-insuline" options={{ presentation: "modal" }} />
        <Stack.Screen name="ajouter-poids" options={{ presentation: "modal" }} />
        <Stack.Screen name="ajouter-activite" options={{ presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="supprimer-compte" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      {/* Vue publique pour un proche : accessible avec ou sans session (déclarée en dernier pour ne jamais servir de route par défaut) */}
      <Stack.Screen name="proche/[token]" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <KeyboardProvider>
          <ToastProvider>
            <AuthProvider>
              <WebAppShell><RootNavigator /></WebAppShell>
            </AuthProvider>
          </ToastProvider>
        </KeyboardProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
