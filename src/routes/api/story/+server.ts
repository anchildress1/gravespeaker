import { apiError, providerFailed } from '#lib/server/http.ts';
import { inscriptionSchema } from '#lib/server/research.ts';
import { candidateInputSchema, runStoneStory, runStory } from '#lib/server/story.ts';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	inscription: inscriptionSchema,
	candidate: candidateInputSchema.optional()
});

/**
 * Tells the story of a confirmed candidate, or of the stone alone when no candidate is sent.
 * @param event Request with `{ inscription, candidate? }` JSON.
 * @param event.request The incoming request.
 * @returns A `Story`, or an `ApiError`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return apiError('invalid_input', 'Send an inscription.', 400);
	const { inscription, candidate } = body.data;
	try {
		return Response.json(
			await (candidate ? runStory(inscription, candidate) : runStoneStory(inscription))
		);
	} catch (e) {
		return providerFailed(e);
	}
};
