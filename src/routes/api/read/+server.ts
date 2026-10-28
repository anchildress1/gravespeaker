import { inference } from '#lib/server/inference/gemma.ts';
import { apiError, providerFailed } from '#lib/server/http.ts';
import { normalizeInscriptions } from '#lib/server/inscription.ts';
import type { RequestHandler } from './$types';

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Reads the people on an uploaded headstone photo.
 * @param event Request with multipart field `image`.
 * @param event.request The incoming request.
 * @returns `{ people }`, or an `ApiError`.
 */
export const POST: RequestHandler = async ({ request }) => {
	let image: FormDataEntryValue | null;
	try {
		image = (await request.formData()).get('image');
	} catch {
		return apiError('invalid_input', 'Send a photo in the "image" field.', 400);
	}
	if (!(image instanceof File)) {
		return apiError('invalid_input', 'Send a photo in the "image" field.', 400);
	}
	if (!ACCEPTED.has(image.type)) {
		return apiError('unsupported_type', 'Use a JPEG, PNG, WebP or HEIC photo.', 415);
	}
	if (image.size > MAX_BYTES) {
		return apiError('too_large', 'That photo is over 10 MB. Try a smaller one.', 413);
	}
	try {
		const raw = await inference.readStone(new Uint8Array(await image.arrayBuffer()), image.type);
		return Response.json({ people: normalizeInscriptions(raw) });
	} catch (e) {
		return providerFailed(e);
	}
};
