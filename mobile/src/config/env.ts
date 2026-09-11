import Constants from 'expo-constants';

// Thin typed accessor over app.config.ts's `extra` block — the single place
// the rest of the app reads environment-driven configuration from, so no
// other file reaches into `Constants.expoConfig` directly.

export type AppEnvironment = 'development' | 'uat' | 'production';

interface ExpoExtra {
  appEnv: AppEnvironment;
  apiBaseUrl: string;
  inviteBaseUrl: string;
  eas?: { projectId?: string };
}

function readExtra(): ExpoExtra {
  const extra = Constants.expoConfig?.extra as ExpoExtra | undefined;
  if (!extra) {
    throw new Error('env.ts: Constants.expoConfig.extra is missing — app.config.ts did not run as expected.');
  }
  return extra;
}

export const env = {
  get appEnv(): AppEnvironment {
    return readExtra().appEnv;
  },
  get apiBaseUrl(): string {
    return readExtra().apiBaseUrl;
  },
  get inviteBaseUrl(): string {
    return readExtra().inviteBaseUrl;
  },
  get isDevelopment(): boolean {
    return readExtra().appEnv === 'development';
  },
};
