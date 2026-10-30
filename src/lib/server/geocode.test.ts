import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placeAt } from './geocode';

const eugene = { lat: 44.052099, lon: -123.086754 };
let urls: string[];

/**
 * Stubs the Nominatim boundary.
 * @param respond Builds each response.
 */
const stub = (respond: () => Response | Promise<Response>) => {
	urls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			urls.push(url);
			return respond();
		})
	);
};

/**
 * Builds a Nominatim reverse response.
 * @param address Address parts.
 * @returns The response.
 */
const reply = (address: Record<string, string>) => Response.json({ address });

let clock = Date.UTC(2026, 9, 29);
beforeEach(() => {
	vi.useFakeTimers();
	// Each test starts past the previous one's rate-limit slot.
	vi.setSystemTime((clock += 10_000));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('placeAt', () => {
	it('names the town and state', async () => {
		stub(() => reply({ city: 'Eugene', county: 'Lane County', state: 'Oregon' }));
		expect(await placeAt(eugene)).toBe('Eugene, Oregon');
	});

	it.each([
		[{ town: 'Lolo', state: 'Montana' }, 'Lolo, Montana'],
		[{ village: 'Ashby', state: 'Massachusetts' }, 'Ashby, Massachusetts'],
		[{ county: 'Lane County', state: 'Oregon' }, 'Lane County, Oregon'],
		[{ town: 'Westport', country: 'Ireland' }, 'Westport, Ireland'],
		[{ state: 'Oregon' }, 'Oregon']
	])('builds the place from %o', async (address, place) => {
		stub(() => reply(address));
		expect(await placeAt(eugene)).toBe(place);
	});

	it('sends coordinates rounded to about a kilometre', async () => {
		stub(() => reply({ city: 'Eugene', state: 'Oregon' }));
		await placeAt(eugene);
		const params = new URL(urls[0]).searchParams;
		expect([params.get('lat'), params.get('lon')]).toEqual(['44.05', '-123.09']);
	});

	it.each([
		['an HTTP error', () => new Response('busy', { status: 429 })],
		['no address', () => Response.json({ error: 'Unable to geocode' })],
		[
			'a network failure',
			() => {
				throw new TypeError('fetch failed');
			}
		]
	])('returns null on %s', async (_, respond) => {
		stub(respond);
		expect(await placeAt(eugene)).toBeNull();
	});

	it('waits a second between lookups', async () => {
		stub(() => reply({ city: 'Eugene', state: 'Oregon' }));
		await placeAt(eugene);
		const second = placeAt(eugene);
		await vi.advanceTimersByTimeAsync(999);
		expect(urls).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(await second).toBe('Eugene, Oregon');
		expect(urls).toHaveLength(2);
	});
});
