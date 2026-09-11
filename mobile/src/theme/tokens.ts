// Spacing/typography/color primitives — intentionally small. This is a
// foundation for the first few screens, not a full design system; grow it
// as real screens need more, rather than pre-building tokens nothing uses
// yet.

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 12,
  lg: 20,
  full: 999,
} as const;

// Minimum touch target per WCAG 2.5.5 / iOS HIG (44pt) / Material (48dp) —
// components use this rather than an ad hoc number.
export const minTouchTarget = 44;

export const typography = {
  // Sizes only — actual RN <Text> honors the OS "larger text" accessibility
  // setting automatically via allowFontScaling (default true, never disabled
  // by any component in this app) rather than something tokens can encode.
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
};

export interface ColorTokens {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  danger: string;
  dangerSurface: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  disabled: string;
}

// Light/dark pairs chosen for WCAG AA contrast against their own surface —
// not a full brand palette (Paramount Care brand colors haven't been
// supplied), just enough to build real, accessible screens now and swap in
// brand colors later without touching component code.
export const lightColors: ColorTokens = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1F5',
  border: '#D8DCE3',
  text: '#12161C',
  textMuted: '#5B6572',
  primary: '#0B5FFF',
  primaryText: '#FFFFFF',
  danger: '#B3261E',
  dangerSurface: '#FBEAE9',
  success: '#1E7A46',
  successSurface: '#E8F5EC',
  warning: '#8A5A00',
  warningSurface: '#FBF1DC',
  disabled: '#B7BEC7',
};

export const darkColors: ColorTokens = {
  background: '#0E1116',
  surface: '#171B21',
  surfaceAlt: '#1E232B',
  border: '#2B313B',
  text: '#F2F4F7',
  textMuted: '#9AA4B2',
  primary: '#5B9BFF',
  primaryText: '#0E1116',
  danger: '#FF8983',
  dangerSurface: '#3A1F1E',
  success: '#7BD79E',
  successSurface: '#173A26',
  warning: '#F2C063',
  warningSurface: '#3A2C0F',
  disabled: '#454C57',
};
