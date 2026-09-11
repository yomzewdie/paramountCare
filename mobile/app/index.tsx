import { Redirect } from 'expo-router';

// Always enters through the unauthenticated group first — if the applicant
// is actually already signed in, (auth)/_layout.tsx's own guard immediately
// redirects onward to (app)/home. Keeping the auth-state check in exactly
// one place (each group's own layout) rather than duplicating it here too.
export default function Index() {
  return <Redirect href="/(auth)/welcome" />;
}
