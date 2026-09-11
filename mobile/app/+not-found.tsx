import { Link } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { EmptyState } from '../src/components/StatusStates';
import { useTheme } from '../src/theme/ThemeProvider';

export default function NotFound() {
  const theme = useTheme();
  return (
    <Screen>
      <EmptyState title="Page not found" message="That screen doesn't exist." />
      <Link href="/" style={{ marginTop: theme.spacing.lg, textAlign: 'center', color: theme.colors.primary }}>
        Go back home
      </Link>
    </Screen>
  );
}
