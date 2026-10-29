import { defineEnvVars } from '@sveltejs/kit/env';

// Optional at boot so build and unit tests run without keys; `src/lib/server/env.ts` enforces presence on use.
export const variables = defineEnvVars({
	GEMINI_API_KEY: { schema: (value) => value },
	SERPAPI_API_KEY: { schema: (value) => value },
	ELEVENLABS_API_KEY: { schema: (value) => value }
});
