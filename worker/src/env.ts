import type { JwtPayload } from './utils/jwt';

export type AppEnv = {
  Bindings: Env & {
    RESEND_API_KEY: string;
    ADMIN_NOTIFICATION_EMAIL: string;
    ADMIN_JWT_SECRET: string;  // Cloudflare secret — never in wrangler.jsonc
  };
  Variables: {
    jwtPayload: JwtPayload;
  };
};
