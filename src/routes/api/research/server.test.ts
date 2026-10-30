import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/env.ts', () => ({ geminiApiKey: () => 'test', serpApiKey: () => 'test' }));

const { POST } = await import('./+server');

const stone = {
	carvedName: 'Gaynor Claire Hawks',
	name: 'Gaynor Claire Hawks',
	maidenName: null,
	place: null,
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
		stub(() => Response.json({ organic_results: [] }));
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

describe('POST /api/research phases', () => {
	const near = { ...stone, place: 'Eugene, Oregon' };
	const dated = 'Gaynor Claire Hawks (1932-2017)';

	/**
	 * Builds a SerpApi reply with one result.
	 * @param link Result URL.
	 * @param snippet Result snippet.
	 * @returns The response.
	 */
	const one = (link: string, snippet: string) => () =>
		Response.json({ organic_results: [{ link, title: 'Gaynor Hawks', snippet }] });

	/**
	 * Stubs SerpApi per engine and phase: 1 is name and dates, 2 adds the town, 3 is name and town.
	 * A `k` marks the same phase with death keywords.
	 * Unlisted searches find nothing.
	 * @param answers Reply per key such as `yandex1` or `google3`.
	 * @returns The billed searches in the order they ran.
	 */
	const route = (answers: Record<string, () => Response>): string[] => {
		const ran: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string) => {
				const url = new URL(input);
				const q = url.searchParams.get('q') ?? url.searchParams.get('text') ?? '';
				const phase = !q.includes('eugene') ? 1 : q.includes('1932') ? 2 : 3;
				const key = `${url.searchParams.get('engine')}${phase}${q.includes('obituary') ? 'k' : ''}`;
				ran.push(key);
				return (answers[key] ?? (() => Response.json({ organic_results: [] })))();
			})
		);
		return ran;
	};

	/**
	 * Calls the endpoint and lists the first source of each candidate.
	 * @param body Inscription to research.
	 * @returns Candidate source URLs.
	 */
	const urls = async (body: unknown) =>
		((await (await call(body)).json()).candidates as { sources: { url: string }[] }[]).map(
			(c) => c.sources[0].url
		);

	it('stops at a dated Yandex match without spending a Google search', async () => {
		const ran = route({ yandex1: one('https://a.com/g', dated) });
		expect(await urls(near)).toEqual(['https://a.com/g']);
		expect(ran).toEqual(['yandex1']);
	});

	it('asks Google the same query when Yandex misses', async () => {
		const ran = route({
			yandex1: one('https://a.com/g', 'Gaynor Hawks, singer'),
			google1: one('https://a.com/y', dated)
		});
		expect(await urls(near)).toEqual(['https://a.com/y']);
		expect(ran).toEqual(['yandex1', 'google1']);
	});

	it('adds the town when name and dates find nobody dated', async () => {
		const ran = route({ yandex2: one('https://a.com/near', dated) });
		expect(await urls(near)).toEqual(['https://a.com/near']);
		expect(ran).toEqual(['yandex1', 'google1', 'yandex1k', 'google1k', 'yandex2']);
	});

	it('drops the dates from the query as the last phase', async () => {
		const ran = route({ google3: one('https://a.com/town', 'Gaynor Hawks, who died in 2017') });
		expect(await urls(near)).toEqual(['https://a.com/town']);
		expect(ran).toEqual([
			...['yandex1', 'google1', 'yandex1k', 'google1k'],
			...['yandex2', 'google2', 'yandex2k', 'google2k'],
			...['yandex3', 'google3']
		]);
	});

	it('never searches a phase that needs a town the stone does not have', async () => {
		const ran = route({ yandex1: one('https://a.com/g', 'Gaynor Hawks, singer') });
		expect(await urls(stone)).toEqual(['https://a.com/g']);
		expect(ran).toEqual(['yandex1', 'google1', 'yandex1k', 'google1k']);
	});

	it('returns the name-only matches found when every phase misses', async () => {
		route({
			yandex1: one('https://a.com/g', 'Gaynor Hawks, singer'),
			yandex3: one('https://a.com/t', 'Gaynor Hawks, painter')
		});
		const { candidates } = await (await call(near)).json();
		expect(candidates).toHaveLength(1);
		expect(candidates[0].confidence).toBe('low');
		expect(candidates[0].sources.map((x: { url: string }) => x.url)).toEqual([
			'https://a.com/g',
			'https://a.com/t'
		]);
	});

	it('merges a page both engines return into one source', async () => {
		route({
			yandex1: one('https://www.a.com/p/', 'Gaynor Hawks, singer'),
			google1: () =>
				Response.json({
					organic_results: [
						{ link: 'https://a.com/p', title: 'Dup', snippet: 'Gaynor Hawks, singer' },
						{ link: 'https://b.com/q', title: 'Obit', snippet: dated }
					]
				})
		});
		const { candidates } = await (await call(stone)).json();
		expect(candidates[0].sources.map((x: { id: string; url: string }) => [x.id, x.url])).toEqual([
			['s2', 'https://b.com/q']
		]);
	});

	it('keeps the dates a later search shows for a page already found', async () => {
		route({
			yandex1: one('https://a.com/p', 'Gaynor Hawks, singer'),
			yandex2: one('https://a.com/p', dated)
		});
		const { candidates } = await (await call(near)).json();
		expect(candidates[0].confidence).toBe('high');
	});

	it('keeps the best result of every phase ahead of a crowd from the first', async () => {
		route({
			yandex1: () =>
				Response.json({
					organic_results: Array.from({ length: 6 }, (_, i) => ({
						link: `https://a.com/${i}`,
						title: 'Gaynor Hawks',
						snippet: 'Gaynor Hawks, singer'
					}))
				}),
			yandex2: one('https://b.com/later', 'Gaynor Hawks, painter')
		});
		const [c] = (await (await call(near)).json()).candidates;
		expect(c.sources.map((x: { url: string }) => x.url)).toContain('https://b.com/later');
	});

	it('adds the death keywords only when the plain query finds nobody dated', async () => {
		const ran = route({ google1k: one('https://a.com/obit', dated) });
		expect(await urls(stone)).toEqual(['https://a.com/obit']);
		expect(ran).toEqual(['yandex1', 'google1', 'yandex1k', 'google1k']);
	});

	it("keeps the second engine's best result ahead of the first engine's crowd", async () => {
		route({
			yandex1: () =>
				Response.json({
					organic_results: Array.from({ length: 6 }, (_, i) => ({
						link: `https://a.com/${i}`,
						title: 'Gaynor Hawks',
						snippet: 'Gaynor Hawks, singer'
					}))
				}),
			google1: one('https://b.com/top', 'Gaynor Hawks, painter')
		});
		const [c] = (await (await call(stone)).json()).candidates;
		expect(c.sources.map((x: { url: string }) => x.url).slice(0, 2)).toEqual([
			'https://a.com/0',
			'https://b.com/top'
		]);
	});

	it('uses Yandex when it answers on a retry', async () => {
		let calls = 0;
		const ran = route({
			yandex1: () =>
				calls++
					? one('https://a.com/y', dated)()
					: Response.json({ error: 'down' }, { status: 500 })
		});
		expect(await urls(stone)).toEqual(['https://a.com/y']);
		expect(ran).toEqual(['yandex1', 'yandex1']);
	}, 60_000);

	it('reports an outage that starts after the first search instead of finding nobody', async () => {
		/**
		 * Answers with a server error.
		 * @returns The response.
		 */
		const down = () => Response.json({ error: 'down' }, { status: 500 });
		const ran = route({ google1: down, yandex1k: down, google1k: down });
		const res = await call(stone);
		expect(res.status).toBe(502);
		// Stops once both engines fail in a row, before spending the rest of the plan.
		expect(new Set(ran)).toEqual(new Set(['yandex1', 'google1', 'yandex1k']));
	}, 60_000);

	it('uses Google when Yandex keeps failing', async () => {
		route({
			yandex1: () => Response.json({ error: 'down' }, { status: 500 }),
			google1: one('https://a.com/y', dated)
		});
		expect(await urls(stone)).toEqual(['https://a.com/y']);
	}, 60_000);

	it('gives up with 502 when every engine fails, without trying the next phase', async () => {
		const ran = route({
			yandex1: () => Response.json({ error: 'down' }, { status: 500 }),
			google1: () => Response.json({ error: 'down' }, { status: 500 })
		});
		const res = await call(near);
		expect(res.status).toBe(502);
		expect(ran.filter((k) => !k.endsWith('1'))).toEqual([]);
	}, 60_000);
});
