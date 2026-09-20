import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Redirect, Tabs, usePathname } from 'expo-router';
import { useAuth } from '../../src/features/auth/AuthContext';
import { SessionProvider } from '../../src/features/onboarding/SessionContext';
import { useTheme } from '../../src/theme/ThemeProvider';

// Icon size chosen to feel native/balanced in a standard bottom tab bar
// (Apple HIG-range, and matches the row height the tab bar already
// reserves for an icon — see the real triangle placeholder these replaced,
// react-navigation's own MissingIcon, which occupied this exact same slot).
const TAB_ICON_SIZE = 24;

type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface TabConfig {
  /** Matches the route file name under app/(app)/ exactly (Tabs.Screen's
   * own `name` prop) — never the display title. */
  name: string;
  title: string;
  activeIcon: IoniconName;
  inactiveIcon: IoniconName;
}

/** The bottom tab bar's real content and order, in one place — exported so
 * tab order/labels/icon names are directly unit-testable without a full
 * navigator render (same reasoning as REAL_STEP_SCREENS in
 * onboarding/[stepId].tsx — see __tests__/_layout.test.ts). */
export const TAB_CONFIG: TabConfig[] = [
  { name: 'home', title: 'Home', activeIcon: 'home', inactiveIcon: 'home-outline' },
  {
    name: 'onboarding',
    // Display label only — the route segment itself stays "onboarding"
    // (file path, every router.push/router.replace target, and the nested
    // Stack's own screens are all unaffected by this label). The 4-phase
    // journey pass reverted this from "Checklist" back to "Onboarding" per
    // explicit direction.
    title: 'Onboarding',
    activeIcon: 'clipboard',
    inactiveIcon: 'clipboard-outline',
  },
  { name: 'profile', title: 'Profile', activeIcon: 'person', inactiveIcon: 'person-outline' },
  { name: 'help', title: 'Help', activeIcon: 'help-circle', inactiveIcon: 'help-circle-outline' },
];

export default function AppLayout() {
  const { status } = useAuth();
  const theme = useTheme();
  const pathname = usePathname();

  // The authoritative navigation guard for every authenticated screen: a
  // signed-out applicant reaching here (deep link, stale link, session
  // expired mid-use — see AuthContext's auth-expired listener) is sent back
  // to Welcome rather than shown any authenticated content.
  if (status === 'signedOut') {
    return <Redirect href="/(auth)/welcome" />;
  }

  // A step FORM screen (e.g. /onboarding/personal_info) already has its own
  // sticky bottom action bar (Screen's `footer` prop, see OnboardingHeader's
  // own comment) — showing the tab bar underneath it too would mean two
  // competing bottom bars. The onboarding step LIST (/onboarding) has no
  // bottom action area of its own, so it keeps the tab bar. usePathname()
  // strips route-group segments, so this is `/onboarding` for the list and
  // `/onboarding/<stepId>` for a step screen — no risky restructuring of
  // the existing nested Stack (onboarding/_layout.tsx) needed to make this
  // distinction.
  const onStepDetailScreen = pathname.startsWith('/onboarding/');

  // Mounted only once the applicant is authenticated — SessionProvider
  // begins its GET-mine/create-if-missing flow (see SessionContext.tsx)
  // immediately, which is correct: an authenticated applicant with no
  // session yet is exactly the "create one" case, not something to defer
  // until a screen asks for it.
  return (
    <SessionProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.textMuted,
          tabBarStyle: onStepDetailScreen
            ? { display: 'none' }
            : { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
        }}
      >
        {TAB_CONFIG.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              tabBarIcon: ({ focused, color }) => (
                <Ionicons name={focused ? tab.activeIcon : tab.inactiveIcon} size={TAB_ICON_SIZE} color={color} />
              ),
            }}
          />
        ))}
      </Tabs>
    </SessionProvider>
  );
}
