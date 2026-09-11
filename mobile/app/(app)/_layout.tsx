import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/features/auth/AuthContext';

export default function AppLayout() {
  const { status } = useAuth();

  // The authoritative navigation guard for every authenticated screen: a
  // signed-out applicant reaching here (deep link, stale link, session
  // expired mid-use — see AuthContext's auth-expired listener) is sent back
  // to Welcome rather than shown any authenticated content.
  if (status === 'signedOut') {
    return <Redirect href="/(auth)/welcome" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
