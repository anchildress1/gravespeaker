import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/env.ts', () => ({ geminiApiKey: () => 'test', serpApiKey: () => 'test' }));

const { POST } = await import('./+server');

/**
 * Test helper.
 * @param text Test input.
 * @returns The fixture.
 */
const reply = (text: string) =>
	new Response(
		JSON.stringify({
			candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
			usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);

const hawks = JSON.stringify({
	people: [{ name: 'Gaynor Claire Hawks née Staples', born: '1932-03-10', died: '2017-12-27' }]
});

/**
 * Stubs the Gemini boundary.
 * @param respond Builds each response.
 * @returns The fixture.
 */
const stubGemini = (respond: () => Response) =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => respond())
	);

/**
 * Calls the endpoint with an optional upload.
 * @param file Upload, or undefined for an empty form.
 * @returns The response.
 */
const call = (file?: File) => {
	const body = new FormData();
	if (file) body.set('image', file);
	return POST({ request: new Request('http://x/api/read', { method: 'POST', body }) } as never);
};
/**
 * Test helper.
 * @returns The fixture.
 */
const jpeg = () => new File([new Uint8Array([1, 2, 3])], 's.jpg', { type: 'image/jpeg' });

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/read', () => {
	it('rejects a missing image', async () => {
		const res = await call();
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('invalid_input');
	});

	it('rejects a non-image upload', async () => {
		const res = await call(new File(['x'], 'a.txt', { type: 'text/plain' }));
		expect(res.status).toBe(415);
		expect((await res.json()).error.code).toBe('unsupported_type');
	});

	it('rejects a photo over 10 MB', async () => {
		const big = new File([new Uint8Array(11 * 1024 * 1024)], 'b.jpg', { type: 'image/jpeg' });
		const res = await call(big);
		expect(res.status).toBe(413);
		expect((await res.json()).error.code).toBe('too_large');
	});

	it('returns the normalized person', async () => {
		stubGemini(() => reply(hawks));
		const res = await call(jpeg());
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			people: [
				{
					carvedName: 'Gaynor Claire Hawks née Staples',
					name: 'Gaynor Claire Hawks',
					maidenName: 'Staples',
					born: '1932-03-10',
					died: '2017-12-27'
				}
			]
		});
	});

	it('parses a reply wrapped in a code fence', async () => {
		stubGemini(() => reply('```json\n' + hawks + '\n```'));
		const res = await call(jpeg());
		expect(res.status).toBe(200);
		expect((await res.json()).people[0].name).toBe('Gaynor Claire Hawks');
	});

	it('returns no people when the only name has no letters', async () => {
		stubGemini(() => reply(JSON.stringify({ people: [{ name: '[]', born: null, died: null }] })));
		const res = await call(jpeg());
		expect(await res.json()).toEqual({ people: [] });
	});

	it('returns 502 when Gemini fails on every attempt', async () => {
		stubGemini(
			() =>
				new Response(JSON.stringify({ error: { code: 503, message: 'overloaded' } }), {
					status: 503,
					headers: { 'content-type': 'application/json' }
				})
		);
		const res = await call(jpeg());
		expect(res.status).toBe(502);
		expect((await res.json()).error.code).toBe('provider_failed');
	}, 60_000);

	it('accepts a HEIC upload', async () => {
		stubGemini(() => reply(hawks));
		const heic = new File([new Uint8Array([1])], 's.heic', { type: 'image/heic' });
		expect((await call(heic)).status).toBe(200);
	});

	it('rejects a body that is not multipart form data', async () => {
		const res = await POST({
			request: new Request('http://x/api/read', { method: 'POST', body: 'nope' })
		} as never);
		expect(res.status).toBe(400);
	});
});
