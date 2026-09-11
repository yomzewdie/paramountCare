import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { spacing, radii, typography, minTouchTarget, lightColors, darkColors, type ColorTokens } from './tokens';

interface Theme {
  colors: ColorTokens;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  minTouchTarget: number;
  scheme: 'light' | 'dark';
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Structural dark-mode support from day one (system-driven, via
  // useColorScheme) — even though the first visual pass targets light mode,
  // no component reaches for a hardcoded color instead of this context, so
  // dark mode requires no later rework, only palette refinement.
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  const theme = useMemo<Theme>(
    () => ({
      colors: scheme === 'dark' ? darkColors : lightColors,
      spacing,
      radii,
      typography,
      minTouchTarget,
      scheme,
    }),
    [scheme],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be used within a ThemeProvider');
  return ctx;
}
