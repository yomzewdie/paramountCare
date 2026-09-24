import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		setupFiles: ['./test/setup.ts'],
		// test/node/** runs under vitest.config.node.mts's plain-Node project
		// instead (see that file's own doc comment for why) — excluded here so
		// it is never picked up by the default include glob and run under the
		// Workers pool by mistake. Vitest's own default exclude list is
		// repeated explicitly alongside it, since supplying `exclude` at all
		// replaces (not merges with) that default.
		exclude: [
			'**/node_modules/**', '**/dist/**', '**/cypress/**',
			'**/.{idea,git,cache,output,temp}/**',
			'**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
			'test/node/**',
		],
		poolOptions: {
			workers: {
				wrangler: { configPath: "./wrangler.jsonc" },
				// Deterministic, fixed test-only values for the secret bindings
				// (worker/src/env.ts) that .dev.vars supplies in real dev/prod —
				// deliberately NOT read from .dev.vars, so the test suite is fully
				// self-contained and behaves identically with or without a local
				// .dev.vars file (CI never has one). These are not real secrets:
				// nothing here is used against production, and rotating them
				// requires no coordination with any real deployment.
				miniflare: {
					bindings: {
						ENVIRONMENT: 'test',
						ADMIN_JWT_SECRET: 'test-only-jwt-signing-secret-not-for-production-use',
						// Deliberately a different string from ADMIN_JWT_SECRET above (not
						// reused) — same domain-separation reasoning as production, see
						// worker/src/env.ts.
						EMAIL_VERIFICATION_SECRET: 'test-only-email-verification-hmac-secret-not-for-production-use',
						// Deliberately a different string from both secrets above — same
						// domain-separation reasoning, see worker/src/env.ts and
						// services/inviteCode.ts.
						INVITE_CODE_SECRET: 'test-only-invite-code-hmac-secret-not-for-production-use',
						RESEND_API_KEY: 'test-only-placeholder-resend-key',
						ADMIN_NOTIFICATION_EMAIL: 'admin-notifications-test@example.com',
					},
				},
			},
		},
	},
});
