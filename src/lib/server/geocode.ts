import type { Coordinates } from './photo-location.ts';

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
// Nominatim's usage policy requires a User-Agent that identifies the application.
const USER_AGENT = 'Gravespeaker (+https://github.com/anchildress1/gravespeaker)';
const TIMEOUT_MS = 5000;
// The usage policy caps clients at one request per second.
const MIN_GAP_MS = 1000;
// Every read waits on the lookup, so a burst must drop the place rather than queue for minutes.
const MAX_WAIT_MS = 2000;

interface Address {
	city?: string;
	town?: string;
	village?: string;
	hamlet?: string;
	county?: string;
	state?: string;
	country?: string;
}

let nextSlot = 0;

/**
 * Waits for this process's next one-per-second slot, unless the queue is too long.
 * @returns False when the slot is too far off; no slot is taken then.
 */
async function throttle(): Promise<boolean> {
	const now = Date.now();
	const at = Math.max(now, nextSlot);
	if (at - now > MAX_WAIT_MS) return false;
	nextSlot = at + MIN_GAP_MS;
	if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
	return true;
}

/**
 * Names the town and state or country at a point, for narrowing search.
 * @param at Where the photo was taken or the visitor stands.
 * @returns For example "Eugene, Oregon", or null when the lookup fails, finds no place or is too busy.
 */
export async function placeAt(at: Coordinates): Promise<string | null> {
	// Two decimals is about a kilometre: enough for the town, without sending the visitor's spot.
	const params = new URLSearchParams({
		format: 'jsonv2',
		lat: at.lat.toFixed(2),
		lon: at.lon.toFixed(2),
		zoom: '10',
		addressdetails: '1'
	});
	if (!(await throttle())) return null;
	try {
		const res = await fetch(`${ENDPOINT}?${params}`, {
			headers: { 'user-agent': USER_AGENT, 'accept-language': 'en' },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) return null;
		const { address } = (await res.json()) as { address?: Address };
		const local =
			address?.city ?? address?.town ?? address?.village ?? address?.hamlet ?? address?.county;
		const region = address?.state ?? address?.country;
		return [local, region].filter(Boolean).join(', ') || null;
	} catch {
		// The place only sharpens the search; reading the stone must not fail because of it.
		return null;
	}
}
