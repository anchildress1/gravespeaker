import { inference } from '#lib/server/inference/gemma.ts';
import { apiError, providerFailed } from '#lib/server/http.ts';
import { placeAt } from '#lib/server/geocode.ts';
import { normalizeInscriptions } from '#lib/server/inscription.ts';
import { photoLocation, type Coordinates } from '#lib/server/photo-location.ts';
import type { RequestHandler } from './$types';

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Reads optional `lat` and `lon` form fields.
 * @param form The submitted form.
 * @returns The coordinates, null when both are absent, or undefined when they are not a valid point.
 */
function formLocation(form: FormData): Coordinates | null | undefined {
	const lat = form.get('lat');
	const lon = form.get('lon');
	if (lat === null && lon === null) return null;
	const point = { lat: Number(lat), lon: Number(lon) };
	const valid =
		typeof lat === 'string' &&
		typeof lon === 'string' &&
		lat.trim() !== '' &&
		lon.trim() !== '' &&
		Math.abs(point.lat) <= 90 &&
		Math.abs(point.lon) <= 180;
	return valid ? point : undefined;
}

/**
 * Reads the people on an uploaded headstone photo, with the town it was taken in when the visitor's
 * location or the photo's GPS gives one.
 * @param event Request with multipart field `image` and optional `lat` and `lon`.
 * @param event.request The incoming request.
 * @returns `{ people }`, or an `ApiError`.
 */
export const POST: RequestHandler = async ({ request }) => {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return apiError('invalid_input', 'Send a photo in the "image" field.', 400);
	}
	const image = form.get('image');
	if (!(image instanceof File)) {
		return apiError('invalid_input', 'Send a photo in the "image" field.', 400);
	}
	if (!ACCEPTED.has(image.type)) {
		return apiError('unsupported_type', 'Use a JPEG, PNG, WebP or HEIC photo.', 415);
	}
	if (image.size > MAX_BYTES) {
		return apiError('too_large', 'That photo is over 10 MB. Try a smaller one.', 413);
	}
	const sent = formLocation(form);
	if (sent === undefined) {
		return apiError('invalid_input', 'Send "lat" and "lon" as a valid point, or neither.', 400);
	}
	const bytes = new Uint8Array(await image.arrayBuffer());
	const at = sent ?? photoLocation(bytes);
	try {
		const [raw, near] = await Promise.all([
			inference.readStone(bytes, image.type),
			at ? placeAt(at) : null
		]);
		// The cemetery's town beats a carved place, which is as often a birthplace as a home.
		const people = normalizeInscriptions(raw).map((p) => ({ ...p, place: near ?? p.place }));
		return Response.json({ people });
	} catch (e) {
		return providerFailed(e);
	}
};
