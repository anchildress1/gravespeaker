import { apiError, providerFailed } from '#lib/server/http.ts';
import { inscriptionSchema, runResearch } from '#lib/server/research.ts';
import type { RequestHandler } from './$types';

/**
 * Finds candidate people for one inscription.
 * @param event Request with an `Inscription` JSON body.
 * @param event.request The incoming request.
 * @returns `{ candidates }`, or an `ApiError`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = inscriptionSchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return apiError('invalid_input', 'Send one inscription.', 400);
	try {
		return Response.json({ candidates: await runResearch(body.data) });
	} catch (e) {
		return providerFailed(e);
	}
};
