import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/features/auth/AuthContext';

export default function AuthLayout() {
  const { status } = useAuth();

  // An already-signed-in applicant navigating (deep link, back button) into
  // an unauthenticated screen is sent straight to the authenticated home
  // instead — there's no reason to show Welcome/Sign In to someone already
  // signed in.
  if (status === 'signedIn') {
    return <Redirect href="/(app)/home" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
