import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/env.ts', () => ({ geminiApiKey: () => 'test', serpApiKey: () => 'test' }));
const page = vi.hoisted(() => ({
	text: 'Gaynor taught piano for forty years. She loved gardening.' as string | null
}));
vi.mock('#lib/server/pages.ts', () => ({ fetchPage: async () => page.text }));

const { POST } = await import('./+server');

const inscription = {
	carvedName: 'Gaynor Claire Hawks',
	name: 'Gaynor Claire Hawks',
	maidenName: null,
	born: '1932-03-10',
	died: '2017-12-27'
};
const candidate = {
	name: 'Gaynor Claire Hawks',
	born: '1932-03-10',
	died: '2017-12-27',
	place: null,
	sources: [
		{ id: 's1', url: 'https://legacy.com/h', title: 'Obit', site: 'legacy.com', snippet: '' }
	]
};

/**
 * Test helper.
 * @param sentences Test input.
 * @returns The fixture.
 */
const gemini = (sentences: unknown[]) =>
	Response.json({
		candidates: [
			{
				content: { role: 'model', parts: [{ text: JSON.stringify({ sentences }) }] },
				finishReason: 'STOP'
			}
		],
		usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
	});
/**
 * Test helper.
 * @param res Test input.
 * @returns The fixture.
 */
const stubModel = (res: () => Response) =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => res())
	);

/**
 * Calls the endpoint.
 * @param body JSON body.
 * @returns The response.
 */
const call = (body: unknown) =>
	POST({
		request: new Request('http://x/api/story', { method: 'POST', body: JSON.stringify(body) })
	} as never);

afterEach(() => {
	vi.unstubAllGlobals();
	page.text = 'Gaynor taught piano for forty years. She loved gardening.';
});

describe('POST /api/story', () => {
	it('rejects an invalid body', async () => {
		const res = await call({ inscription });
		expect(res.status).toBe(400);
	});

	it('rejects a candidate with no sources', async () => {
		expect((await call({ inscription, candidate: { ...candidate, sources: [] } })).status).toBe(
			400
		);
	});

	it('returns a told story without quote, claim or page text', async () => {
		stubModel(() =>
			gemini([
				{
					text: 'I taught piano for forty years.',
					kind: 'fact',
					claim: 'other',
					sourceIds: ['s1'],
					quote: 'taught piano for forty years'
				}
			])
		);
		const res = await call({ inscription, candidate });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('told');
		expect(JSON.stringify(body)).not.toMatch(/quote|claim|loved gardening/);
	});

	it('returns insufficient when only date facts are grounded', async () => {
		stubModel(() =>
			gemini([
				{
					text: 'I was born in 1932.',
					kind: 'fact',
					claim: 'birth',
					sourceIds: ['s1'],
					quote: 'Gaynor taught'
				}
			])
		);
		const res = await call({ inscription, candidate });
		expect(await res.json()).toEqual({ status: 'insufficient' });
	});

	it('returns 502 when the model fails on every attempt', async () => {
		stubModel(() => Response.json({ error: { code: 503, message: 'down' } }, { status: 503 }));
		const res = await call({ inscription, candidate });
		expect(res.status).toBe(502);
		expect((await res.json()).error.code).toBe('provider_failed');
	}, 60_000);

	it('falls back to the search snippet when the page cannot be fetched', async () => {
		page.text = null;
		const withSnippet = {
			...candidate,
			sources: [{ ...candidate.sources[0], snippet: 'Gaynor taught piano for forty years.' }]
		};
		stubModel(() =>
			gemini([
				{
					text: 'I taught piano.',
					kind: 'fact',
					claim: 'other',
					sourceIds: ['s1'],
					quote: 'taught piano for forty years'
				}
			])
		);
		const res = await call({ inscription, candidate: withSnippet });
		expect((await res.json()).status).toBe('told');
	});

	it('drops a fact whose quote is not in the fetched text', async () => {
		stubModel(() =>
			gemini([
				{
					text: 'I flew planes.',
					kind: 'fact',
					claim: 'other',
					sourceIds: ['s1'],
					quote: 'flew planes over the channel'
				}
			])
		);
		const res = await call({ inscription, candidate });
		expect(await res.json()).toEqual({ status: 'insufficient' });
	});
});
