declare module "cloudflare:test" {
	// Extends the raw generated Env (D1/R2 bindings from wrangler.jsonc) with
	// the secret bindings AppEnv also carries (worker/src/env.ts) — those come
	// from .dev.vars at runtime but aren't declared in wrangler.jsonc, so
	// `wrangler types` never adds them to the ambient Env type.
	interface ProvidedEnv extends Env {
		ADMIN_JWT_SECRET: string;
		EMAIL_VERIFICATION_SECRET: string;
		RESEND_API_KEY: string;
		ADMIN_NOTIFICATION_EMAIL: string;
		ENVIRONMENT: string;
	}
}
