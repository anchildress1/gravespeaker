import { apiError, providerFailed } from '#lib/server/http.ts';
import { narrate } from '#lib/server/narration.ts';
import { VOICES } from '#lib/types.ts';
import { z } from 'zod';
import type { RequestHandler } from './$types';

// A story runs 100 to 170 words; the cap keeps this from narrating arbitrary text at our cost.
const MAX_CHARS = 1_500;

const querySchema = z.object({
	text: z.string().trim().min(1).max(MAX_CHARS),
	voice: z.enum(VOICES)
});

/**
 * Streams a story read aloud. GET, so an `<audio>` element can play it as it arrives.
 * @param event Request with `text` and `voice` query parameters.
 * @param event.url The request URL.
 * @returns MP3 audio, or an `ApiError`.
 */
export const GET: RequestHandler = async ({ url }) => {
	const query = querySchema.safeParse(Object.fromEntries(url.searchParams));
	if (!query.success) return apiError('invalid_input', 'Send a story and a voice.', 400);
	try {
		return new Response(await narrate(query.data.text, query.data.voice), {
			headers: { 'content-type': 'audio/mpeg' }
		});
	} catch (e) {
		return providerFailed(e);
	}
};
