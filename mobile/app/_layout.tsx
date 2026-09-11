import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { AuthProvider, useAuth } from '../src/features/auth/AuthContext';
import { OfflineBanner } from '../src/components/OfflineBanner';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Fine to ignore — if this is ever called after the splash already hid
  // (fast reload, etc.) it throws, and there is nothing to prevent by then.
});

function RootNavigator() {
  const { status } = useAuth();
  const theme = useTheme();

  useEffect(() => {
    if (status !== 'loading') {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [status]);

  // Auth-state restoration (a refresh-token round trip) happens before
  // anything renders — the splash screen stays up for it instead of
  // flashing a sign-in screen for a moment before redirecting to the
  // authenticated home. Each route group's own layout also guards against
  // reaching it in the wrong auth state directly (deep link, back button).
  if (status === 'loading') return null;

  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
