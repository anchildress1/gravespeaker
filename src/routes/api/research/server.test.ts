import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/env.ts', () => ({ geminiApiKey: () => 'test', serpApiKey: () => 'test' }));

const { POST } = await import('./+server');

const stone = {
	carvedName: 'Gaynor Claire Hawks',
	name: 'Gaynor Claire Hawks',
	maidenName: null,
	born: '1932-03-10',
	died: '2017-12-27'
};

/**
 * Test helper.
 * @param obj Test input.
 * @returns The fixture.
 */
const gemini = (obj: unknown) =>
	Response.json({
		candidates: [
			{ content: { role: 'model', parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }
		],
		usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
	});

/**
 * Routes stubbed network calls by host.
 * @param serp Handler for SerpApi.
 * @param model Handler for Gemini.
 * @returns The fixture.
 */
const stub = (serp: () => Response, model: () => Response) =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request) =>
			String(input instanceof Request ? input.url : input).includes('serpapi.com')
				? serp()
				: model()
		)
	);

const hits = {
	organic_results: [
		{ link: 'https://legacy.com/hawks', title: 'Gaynor Hawks obituary', snippet: '1932-2017' },
		{ link: 'https://ancestry.com/x', title: 'Gated', snippet: '' }
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

	it('skips the model and returns no candidates when search finds nothing', async () => {
		stub(
			() => Response.json({}),
			() => {
				throw new Error('model must not be called');
			}
		);
		const res = await call(stone);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ candidates: [] });
	});

	it('returns grounded candidates with gated sites removed', async () => {
		stub(
			() => Response.json(hits),
			() =>
				gemini({
					candidates: [
						{
							name: 'Gaynor Claire Hawks',
							born: '1932',
							died: '2017',
							place: null,
							resultIds: ['s1']
						}
					]
				})
		);
		const res = await call(stone);
		expect(res.status).toBe(200);
		const { candidates } = await res.json();
		expect(candidates).toHaveLength(1);
		expect(candidates[0].sources.map((s: { url: string }) => s.url)).toEqual([
			'https://legacy.com/hawks'
		]);
	});

	it('returns 502 when search fails on every attempt', async () => {
		stub(
			() => Response.json({ error: 'down' }, { status: 500 }),
			() => gemini({ candidates: [] })
		);
		const res = await call(stone);
		expect(res.status).toBe(502);
		expect((await res.json()).error.code).toBe('provider_failed');
	}, 60_000);

	it('returns 502 when grouping fails on every attempt', async () => {
		stub(
			() => Response.json(hits),
			() => Response.json({ error: { code: 503, message: 'down' } }, { status: 503 })
		);
		const res = await call(stone);
		expect(res.status).toBe(502);
		expect((await res.json()).error.code).toBe('provider_failed');
	}, 60_000);

	it('drops candidates whose sources never mention the surname', async () => {
		stub(
			() =>
				Response.json({
					organic_results: [
						{ link: 'https://x.com/a', title: 'Unrelated', snippet: 'Smith 1932 2017' }
					]
				}),
			() =>
				gemini({
					candidates: [
						{
							name: 'Gaynor Claire Hawks',
							born: '1932',
							died: '2017',
							place: null,
							resultIds: ['s1']
						}
					]
				})
		);
		expect(await (await call(stone)).json()).toEqual({ candidates: [] });
	});
});
