import type { ExpoConfig, ConfigContext } from 'expo/config';

// Dynamic config (not a static app.json) so the same source can produce three
// distinct app identities — development / uat / production — driven entirely
// by environment variables, never by hardcoded values baked into this file.
// See README.md "Environments" for the full strategy and which values are
// safe to expose client-side vs. must stay server-only secrets (there are no
// secrets in this file — everything here ends up readable inside the
// installed app bundle, by design; Cloudflare Worker secrets like
// ADMIN_JWT_SECRET / EMAIL_VERIFICATION_SECRET never appear on this client).

type AppEnv = 'development' | 'uat' | 'production';

function resolveAppEnv(): AppEnv {
  const raw = process.env.APP_ENV;
  if (raw === 'uat' || raw === 'production') return raw;
  return 'development';
}

// No production API URL is invented here — an unset value in a
// non-development environment is a build-time misconfiguration, not
// something to silently default past (see
// docs/ARCHITECTURE_DECISION_RECORDS.md ADR-015 §11 / the M2
// security-hardening pass).
// Takes the already-read value (not the env var name) — dynamic
// `process.env[name]` access defeats Expo/Metro's static env-var analysis
// (eslint: expo/no-dynamic-env-var) and is unnecessary here anyway since
// there is only ever one call site.
function requireUrlUnlessDev(name: string, value: string | undefined, appEnv: AppEnv, devDefault: string): string {
  if (value) return value;
  if (appEnv === 'development') return devDefault;
  throw new Error(
    `[app.config.ts] ${name} must be set when APP_ENV=${appEnv} — refusing to fall back to a development default in a non-development build.`,
  );
}

const APP_ENV = resolveAppEnv();

// Bundle identifier / package name vary per environment so dev, UAT, and
// production builds can be installed side-by-side on the same device for
// testing, rather than one overwriting another.
const IDENTIFIER_SUFFIX: Record<AppEnv, string> = {
  development: '.dev',
  uat: '.uat',
  production: '',
};

const DISPLAY_NAME: Record<AppEnv, string> = {
  development: 'Paramount Care (Dev)',
  uat: 'Paramount Care (UAT)',
  production: 'Paramount Care',
};

// Custom URL scheme — required by Expo Router itself (dev-client/Expo Go
// launching, `Linking.createURL`, etc.) independent of any particular
// feature; not tied to the invitation flow, which no longer uses links at
// all (see the invitation-code redesign — applicants type a code instead).
// Suffixed per environment for the same side-by-side-install reason as the
// bundle id.
const SCHEME = `paramountcare${IDENTIFIER_SUFFIX[APP_ENV] || ''}`;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: DISPLAY_NAME[APP_ENV],
  slug: 'paramount-care-mobile',
  scheme: SCHEME,
  owner: process.env.EAS_OWNER, // Expo/EAS account or org slug — set via EAS secrets, not committed
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic', // structural dark-mode support — see src/theme
  // Approved brand assets (see mobile/assets/branding/): the app icon uses
  // an icon-mark-only crop (healthcare professional + stethoscope + teal/
  // lime swoosh, no wordmark/tagline — a full logo with text reads poorly
  // at home-screen icon sizes). The native splash screen uses the full
  // logo instead, configured below via the expo-splash-screen plugin —
  // app/_layout.tsx's SplashScreen calls only control *when* it hides, not
  // its appearance.
  ios: {
    bundleIdentifier: `com.paramountcare.applicant${IDENTIFIER_SUFFIX[APP_ENV]}`,
    supportsTablet: false,
    icon: './assets/branding/app-icon-mark.png',
  },
  android: {
    package: `com.paramountcare.applicant${IDENTIFIER_SUFFIX[APP_ENV].replace(/\./g, '_')}`,
    adaptiveIcon: {
      // A dedicated, transparent, safe-zone-inset crop — NOT the opaque iOS
      // app-icon-mark.png. Android's launcher masks (circle/squircle/
      // rounded-square/etc.) only guarantee the center ~66% of this layer
      // stays visible, so this asset keeps its actual artwork within ~60%
      // of the canvas width, well inside that. Background matches the
      // splash's dark brand color rather than white.
      foregroundImage: './assets/branding/adaptive-icon-foreground.png',
      backgroundColor: '#0E1116',
    },
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    // Required by @expo/vector-icons (bottom-tab icons) — expo install's own
    // advice when adding it as a direct dependency.
    'expo-font',
    [
      'expo-image-picker',
      {
        // M13: fallback "choose an existing photo" path for document
        // attachments (voided check today; nursing license / CPR card /
        // other onboarding documents later) — the primary capture path is
        // the native document scanner below.
        photosPermission: 'Paramount Care needs access to your photos so you can attach a document from your library.',
        cameraPermission: 'Paramount Care needs access to your camera so you can scan a document.',
      },
    ],
    [
      // M13 hardening: the primary document-capture path. Wraps Apple
      // VisionKit (iOS) / Google ML Kit Document Scanner (Android) —
      // first-party, on-device scanning UIs with their own live edge
      // detection, auto-capture, crop, and perspective correction, rather
      // than a hand-built camera-overlay/CV pipeline (see ADR-026). Not
      // available in Expo Go — requires a custom dev client / EAS build,
      // matching the posture react-native-signature-canvas (M12) already
      // established for this app.
      'react-native-document-scanner-plugin',
      { cameraPermission: 'Paramount Care needs access to your camera so you can scan a document.' },
    ],
    [
      // Native splash: the full approved logo (wordmark + icon + tagline,
      // already transparent-background), centered and contained on a dark
      // background matching src/theme/tokens.ts's darkColors.background —
      // one fixed brand background regardless of system light/dark mode,
      // not the app's own light/dark theme colors.
      'expo-splash-screen',
      {
        image: './assets/branding/paramount-care-logo.png',
        imageWidth: 220,
        resizeMode: 'contain',
        backgroundColor: '#0E1116',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appEnv: APP_ENV,
    // Client-safe: where to send API requests. Not a secret — the
    // invitation code itself is the credential, this is just an endpoint
    // address.
    apiBaseUrl: requireUrlUnlessDev('API_BASE_URL', process.env.API_BASE_URL, APP_ENV, 'http://localhost:8787'),
    eas: {
      // Static fallback to the real, already-created EAS project
      // (`eas init --account yomzewdie`, @yomzewdie/paramount-care-mobile).
      // Some EAS CLI commands (e.g. `eas device:create`) resolve this config
      // without injecting an eas.json build profile's `env`, so relying on
      // process.env.EAS_PROJECT_ID alone left this unset outside an actual
      // `eas build` invocation. Still overridable via env var if ever needed.
      projectId: process.env.EAS_PROJECT_ID ?? '760d3c4c-d127-415f-b7b2-22c4bbc2dad8',
    },
  },
  // runtimeVersion policy — see README.md "OTA update strategy" for the full
  // rationale: tied to appVersion so a native-module change always forces a
  // new binary build rather than risking an OTA update landing on a binary
  // that can't support it.
  runtimeVersion: { policy: 'appVersion' },
  updates: {
    // Left disabled (no `url`) until an EAS project exists — see
    // README.md "OTA update strategy". Never auto-configured with a guessed
    // project URL.
    enabled: false,
  },
});
