import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/env.ts', () => ({ geminiApiKey: () => 'test', serpApiKey: () => 'test' }));

const { POST } = await import('./+server');

const stone = {
	carvedName: 'Gaynor Claire Hawks',
	name: 'Gaynor Claire Hawks',
	maidenName: null,
	born: '1932-03-10',
	died: '2017-12-27',
	voice: 'female'
};

/**
 * Stubs the SerpApi boundary. Every engine answers with the same handler.
 * @param serp Handler for SerpApi.
 */
const stub = (serp: () => Response): void => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => serp())
	);
};

const hits = {
	organic_results: [
		{
			link: 'https://legacy.com/hawks',
			title: 'Gaynor Hawks obituary',
			snippet: 'Gaynor Claire Hawks (1932-2017)'
		},
		{ link: 'https://ancestry.com/x', title: 'Gated', snippet: 'Gaynor Hawks 1932' }
	]
};

/**
 * Calls the endpoint.
 * @param body JSON body.
 * @returns The response.
 */
const call = (body: unknown) =>
	POST({
		request: new Request('http://x/api/research', { method: 'POST', body: JSON.stringify(body) })
	} as never);

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/research', () => {
	it('rejects an invalid body', async () => {
		const res = await call({ name: 'x' });
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('invalid_input');
	});

	it('returns no candidates when search finds nothing', async () => {
		stub(() => Response.json({}));
		const res = await call(stone);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ candidates: [] });
	});

	it('returns the matching candidate with gated sites removed and duplicates merged', async () => {
		stub(() => Response.json(hits));
		const res = await call(stone);
		expect(res.status).toBe(200);
		const { candidates } = await res.json();
		expect(candidates).toHaveLength(1);
		expect(candidates[0].confidence).toBe('high');
		expect(candidates[0].sources.map((s: { url: string }) => s.url)).toEqual([
			'https://legacy.com/hawks'
		]);
	});

	it('returns the right person even when the death date is not mentioned', async () => {
		stub(() =>
			Response.json({
				organic_results: [
					{
						link: 'https://a.com/1',
						title: 'Obit',
						snippet: 'Gaynor Hawks, born 1932, taught piano.'
					}
				]
			})
		);
		const { candidates } = await (await call(stone)).json();
		expect(candidates).toHaveLength(1);
		expect(candidates[0].confidence).toBe('medium');
	});

	it('leaves out a result that names someone else', async () => {
		stub(() =>
			Response.json({
				organic_results: [
					{ link: 'https://x.com/a', title: 'Unrelated', snippet: 'Smith 1932 2017' }
				]
			})
		);
		expect(await (await call(stone)).json()).toEqual({ candidates: [] });
	});

	it('returns 502 when search fails on every attempt', async () => {
		stub(() => Response.json({ error: 'down' }, { status: 500 }));
		const res = await call(stone);
		expect(res.status).toBe(502);
		expect((await res.json()).error.code).toBe('provider_failed');
	}, 60_000);
});
