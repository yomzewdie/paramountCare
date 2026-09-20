import { Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { formatGreeting } from '../utils/greeting';

interface PersonalizedGreetingProps {
  firstName: string | null | undefined;
}

/** "Hi, {firstName}" / "Welcome back" — see utils/greeting.ts for the
 * fallback rule itself (tested there; this is a thin render wrapper). */
export function PersonalizedGreeting({ firstName }: PersonalizedGreetingProps) {
  const theme = useTheme();
  return (
    <Text style={[theme.typography.display, { color: theme.colors.text }]}>
      {formatGreeting(firstName)}
    </Text>
  );
}
