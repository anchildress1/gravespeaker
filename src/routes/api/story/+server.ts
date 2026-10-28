import { json } from '@sveltejs/kit';
import { apiError, providerFailed } from '#lib/server/http.ts';
import { inscriptionSchema } from '#lib/server/research.ts';
import { candidateInputSchema, runStory } from '#lib/server/story.ts';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const bodySchema = z.object({ inscription: inscriptionSchema, candidate: candidateInputSchema });

/**
 * Tells the story of a confirmed candidate.
 * @param event Request with `{ inscription, candidate }` JSON.
 * @param event.request The incoming request.
 * @returns A `Story`, or an `ApiError`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return apiError('invalid_input', 'Send an inscription and a candidate.', 400);
	try {
		return json(await runStory(body.data.inscription, body.data.candidate));
	} catch (e) {
		return providerFailed(e);
	}
};
