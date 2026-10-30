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
	place: null,
	born: '1932-03-10',
	died: '2017-12-27',
	voice: 'female'
};
const candidate = {
	name: 'Gaynor Claire Hawks',
	born: '1932-03-10',
	died: '2017-12-27',
	confidence: 'high',
	sources: [
		{ id: 's1', url: 'https://legacy.com/h', title: 'Obit', site: 'legacy.com', snippet: '' }
	]
};

/**
 * Builds a Gemini reply carrying text.
 * @param text Model output text.
 * @returns The response.
 */
const reply = (text: string) =>
	Response.json({
		candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
		usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
	});

/**
 * Builds the fact-extraction reply.
 * @param facts Raw facts the model returns.
 * @returns The response.
 */
const factsReply = (facts: unknown[]) => reply(JSON.stringify({ facts }));
const pianoFact = { claim: 'other', sourceId: 's1', quote: 'taught piano for forty years' };

/**
 * Stubs the Gemini boundary with one response per model call, in order.
 * @param responses Responses for the extraction call, then the story call.
 * @returns The stub, to inspect the requests it received.
 */
const stubModel = (...responses: (() => Response)[]) => {
	let i = 0;
	const stub = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]());
	vi.stubGlobal('fetch', stub);
	return stub;
};

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
	it('rejects a body without an inscription', async () => {
		expect((await call({ candidate })).status).toBe(400);
	});

	it('tells the stone alone when no candidate is sent, dropping what the stone does not say', async () => {
		stubModel(() =>
			reply(
				'The fog is thick tonight. My name was Gaynor Claire Hawks. I was born on March 10, 1932. I grew up in Portland.'
			)
		);
		const body = await (await call({ inscription })).json();
		expect(body.status).toBe('stone');
		expect(body.paragraph).toContain('The fog is thick tonight.');
		expect(body.paragraph).toContain('March 10, 1932');
		expect(body.paragraph).not.toContain('Portland');
	});

	it('returns a null stone paragraph when no sentence survives grounding', async () => {
		stubModel(() => reply('I grew up in Portland. I had 3 dogs.'));
		expect(await (await call({ inscription })).json()).toEqual({
			status: 'stone',
			paragraph: null,
			voice: 'female'
		});
	});

	it('rejects a candidate with more than five sources', async () => {
		const sources = Array.from({ length: 6 }, (_, i) => ({
			...candidate.sources[0],
			id: `s${i + 1}`
		}));
		expect((await call({ inscription, candidate: { ...candidate, sources } })).status).toBe(400);
	});

	it('rejects a candidate with no sources', async () => {
		expect((await call({ inscription, candidate: { ...candidate, sources: [] } })).status).toBe(
			400
		);
	});

	it('returns a paragraph and its sources, without quotes or page text', async () => {
		stubModel(
			() => factsReply([pianoFact]),
			() => reply('Come closer. I taught piano for forty years. The silence has no keys.')
		);
		const res = await call({ inscription, candidate });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('told');
		expect(body.sources).toHaveLength(1);
		expect(Object.keys(body).sort()).toEqual(['paragraph', 'sources', 'status', 'voice']);
		expect(JSON.stringify(body)).not.toContain('loved gardening');
	});

	it('falls back to the stone when the facts are only the name and dates', async () => {
		stubModel(
			() => factsReply([{ claim: 'name', sourceId: 's1', quote: 'Gaynor' }]),
			() => reply('Mind the cold. My name was Gaynor Claire Hawks.')
		);
		const res = await call({ inscription, candidate });
		expect(await res.json()).toEqual({
			status: 'stone',
			paragraph: 'Mind the cold. My name was Gaynor Claire Hawks.',
			voice: 'female'
		});
	});

	it('drops a fact whose quote is not in the fetched text', async () => {
		stubModel(
			() => factsReply([{ claim: 'other', sourceId: 's1', quote: 'flew planes over the channel' }]),
			() => reply('Mind the cold.')
		);
		const stub = vi.mocked(fetch);
		expect(await (await call({ inscription, candidate })).json()).toEqual({
			status: 'stone',
			paragraph: 'Mind the cold.',
			voice: 'female'
		});
		// The unverified quote never reaches any model request.
		expect(JSON.stringify(stub.mock.calls)).not.toContain('flew planes');
	});

	it('voices a told story from the pronouns in its facts over the name guess', async () => {
		page.text = 'He taught piano for forty years.';
		stubModel(
			() =>
				factsReply([{ claim: 'other', sourceId: 's1', quote: 'He taught piano for forty years' }]),
			() => reply('I taught piano for forty years.')
		);
		const body = await (await call({ inscription, candidate })).json();
		expect([body.status, body.voice]).toEqual(['told', 'male']);
	});

	it('voices a stone story from the name guess', async () => {
		stubModel(() => reply('Mind the cold.'));
		const body = await (await call({ inscription: { ...inscription, voice: 'male' } })).json();
		expect(body.voice).toBe('male');
	});

	it('rejects an inscription with an unknown voice', async () => {
		expect((await call({ inscription: { ...inscription, voice: 'robot' } })).status).toBe(400);
	});

	it('removes an invented number from the story', async () => {
		stubModel(
			() => factsReply([pianoFact]),
			() => reply('I taught piano for forty years. I lived to be 99.')
		);
		const body = await (await call({ inscription, candidate })).json();
		expect(body.paragraph).not.toContain('99');
	});

	it('falls back to the search snippet when the page cannot be fetched', async () => {
		page.text = null;
		const withSnippet = {
			...candidate,
			sources: [{ ...candidate.sources[0], snippet: 'Gaynor taught piano for forty years.' }]
		};
		stubModel(
			() => factsReply([pianoFact]),
			() => reply('I taught piano for forty years.')
		);
		const res = await call({ inscription, candidate: withSnippet });
		expect((await res.json()).status).toBe('told');
	});

	it('returns 502 when the model fails on every attempt', async () => {
		stubModel(() => Response.json({ error: { code: 503, message: 'down' } }, { status: 503 }));
		const res = await call({ inscription, candidate });
		expect(res.status).toBe(502);
		expect((await res.json()).error.code).toBe('provider_failed');
	}, 60_000);
});
