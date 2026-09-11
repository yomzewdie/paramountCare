import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/features/auth/AuthContext';
import { SessionProvider } from '../../src/features/onboarding/SessionContext';

export default function AppLayout() {
  const { status } = useAuth();

  // The authoritative navigation guard for every authenticated screen: a
  // signed-out applicant reaching here (deep link, stale link, session
  // expired mid-use — see AuthContext's auth-expired listener) is sent back
  // to Welcome rather than shown any authenticated content.
  if (status === 'signedOut') {
    return <Redirect href="/(auth)/welcome" />;
  }

  // Mounted only once the applicant is authenticated — SessionProvider
  // begins its GET-mine/create-if-missing flow (see SessionContext.tsx)
  // immediately, which is correct: an authenticated applicant with no
  // session yet is exactly the "create one" case, not something to defer
  // until a screen asks for it.
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
  );
}
