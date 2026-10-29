import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/env.ts', () => ({ elevenLabsApiKey: () => 'test' }));

const { GET } = await import('./+server');

const story = 'Come closer, and mind the cold. I taught piano for forty years.';

/**
 * Stubs the ElevenLabs boundary.
 * @param respond Builds each response.
 * @returns The stub, to inspect the requests it received.
 */
const stubElevenLabs = (respond: () => Response) => {
	const stub = vi.fn(async () => respond());
	vi.stubGlobal('fetch', stub);
	return stub;
};

/**
 * Calls the endpoint.
 * @param params Query parameters.
 * @returns The response.
 */
const call = (params: Record<string, string>) =>
	GET({ url: new URL(`http://x/api/narrate?${new URLSearchParams(params)}`) } as never);

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('GET /api/narrate', () => {
	it.each([
		['no text', { voice: 'female' }],
		['blank text', { text: '   ', voice: 'female' }],
		['text over the cap', { text: 'x'.repeat(1_501), voice: 'female' }],
		['an unknown voice', { text: story, voice: 'robot' }]
	])('rejects %s without calling ElevenLabs', async (_, params) => {
		const stub = stubElevenLabs(() => new Response());
		const res = await call(params);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('invalid_input');
		expect(stub).not.toHaveBeenCalled();
	});

	it('streams MP3 audio of the story in the chosen voice', async () => {
		const stub = stubElevenLabs(() => new Response(new Uint8Array([0xff, 0xfb])));
		const res = await call({ text: story, voice: 'male' });
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('audio/mpeg');
		expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0xff, 0xfb]);
		const [male] = stub.mock.calls[0] as unknown as [string, RequestInit];
		stub.mockClear();
		await call({ text: story, voice: 'female' });
		const [female] = stub.mock.calls[0] as unknown as [string, RequestInit];
		expect(male).not.toBe(female);
	});

	it('sends the story text to ElevenLabs unchanged', async () => {
		const stub = stubElevenLabs(() => new Response(new Uint8Array([1])));
		await call({ text: story, voice: 'female' });
		const [, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(init.body as string).text).toBe(story);
	});

	it('returns 502 when ElevenLabs fails on every attempt', async () => {
		vi.useFakeTimers();
		stubElevenLabs(() => Response.json({ detail: 'down' }, { status: 503 }));
		const pending = call({ text: story, voice: 'female' });
		// Skips the SDK's retry backoff instead of sleeping through it.
		await vi.runAllTimersAsync();
		const res = await pending;
		expect(res.status).toBe(502);
		expect((await res.json()).error.code).toBe('provider_failed');
	});
});
