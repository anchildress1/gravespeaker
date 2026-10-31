import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({ geminiApiKey: () => 'test', serpApiKey: () => 'test' }));

const { SerpApiProvider } = await import('./serpapi');
const { canonicalUrl } = await import('./url');

/**
 * Stubs SerpApi per engine.
 * @param byEngine Handler per engine name; unlisted engines return no results.
 * @returns The stub, to inspect which engines were called.
 */
const stub = (byEngine: Record<string, () => Response>) => {
	const fn = vi.fn(async (input: string | URL) => {
		const engine = new URL(String(input)).searchParams.get('engine') ?? '';
		return (byEngine[engine] ?? (() => Response.json({ organic_results: [] })))();
	});
	vi.stubGlobal('fetch', fn);
	return fn;
};
/**
 * Builds one organic result.
 * @param link Result link.
 * @param title Result title.
 * @param snippet Result snippet.
 * @returns The result.
 */
const hit = (link: string, title = 'T', snippet = 'S') => ({ link, title, snippet });
/**
 * Builds a handler that answers with results.
 * @param hits Organic results.
 * @returns The handler.
 */
const ok =
	(...hits: ReturnType<typeof hit>[]) =>
	() =>
		Response.json({ organic_results: hits });
/**
 * Answers with a server error.
 * @returns The response.
 */
const down = () => Response.json({ error: 'down' }, { status: 500 });

afterEach(() => vi.unstubAllGlobals());

describe('canonicalUrl', () => {
	it('treats scheme, www, trailing slash, tracking parameters and hash as the same page', () => {
		const keys = [
			'https://www.legacy.com/obit/1/',
			'http://legacy.com/obit/1',
			'https://legacy.com/obit/1?utm_source=x#top'
		].map(canonicalUrl);
		expect(new Set(keys).size).toBe(1);
	});

	it('treats one Find a Grave memorial under different locales and slugs as one page', () => {
		const keys = [
			'https://www.findagrave.com/memorial/30695151/gaynor-hawks',
			'https://da.findagrave.com/memorial/30695151/gaynor-claire-hawks'
		].map(canonicalUrl);
		expect(new Set(keys).size).toBe(1);
	});

	it('keeps pages that differ only in a content-identifying query parameter apart', () => {
		const a = canonicalUrl('https://x.com/obituaries/print?o_id=5589051&utm_source=a');
		const b = canonicalUrl('https://x.com/obituaries/print?utm_source=b&o_id=5589052');
		const a2 = canonicalUrl('https://x.com/obituaries/print?utm_medium=z&o_id=5589051');
		expect(a).not.toBe(b);
		expect(a).toBe(a2);
	});

	it('keeps different pages apart and rejects non-web links', () => {
		expect(canonicalUrl('https://a.com/x')).not.toBe(canonicalUrl('https://a.com/y'));
		expect(canonicalUrl('javascript:alert(1)')).toBeNull();
		expect(canonicalUrl('https://[')).toBeNull();
	});
});

describe('SerpApiProvider', () => {
	const provider = new SerpApiProvider();

	it.each([
		['google', 'q'],
		['yandex', 'text']
	])('sends the query to %s in its own parameter', async (engine, param) => {
		const fn = stub({ [engine]: ok(hit('https://a.com/1')) });
		expect(await provider.search('Gaynor Hawks', engine)).toHaveLength(1);
		const url = new URL(String(fn.mock.calls[0][0]));
		expect([url.searchParams.get('engine'), url.searchParams.get(param)]).toEqual([
			engine,
			'Gaynor Hawks'
		]);
	});

	it('returns an empty list when the engine reports no results', async () => {
		stub({
			google: () => Response.json({ error: "Google hasn't returned any results for this query." })
		});
		expect(await provider.search('q', 'google')).toEqual([]);
	});

	it('throws when the engine fails', async () => {
		stub({ google: down });
		await expect(provider.search('q', 'google')).rejects.toThrow('down');
	});

	it('keeps the status of a failure that answers with a page instead of JSON', async () => {
		stub({ google: () => new Response('<html>Bad gateway</html>', { status: 502 }) });
		await expect(provider.search('q', 'google')).rejects.toThrow('SerpApi 502');
	});

	it('throws when the engine answers with neither results nor an error', async () => {
		stub({ google: () => Response.json({ search_metadata: {} }) });
		await expect(provider.search('q', 'google')).rejects.toThrow('without results');
	});

	it('rejects an engine it does not know', async () => {
		await expect(provider.search('q', 'bing')).rejects.toThrow('Unknown engine bing');
	});

	it('maps hits in rank order with the hostname as site', async () => {
		stub({ google: ok(hit('https://www.legacy.com/a', 'A', 'sa'), hit('https://b.com/', 'B')) });
		expect(await provider.search('q', 'google')).toEqual([
			{ url: 'https://www.legacy.com/a', title: 'A', site: 'www.legacy.com', snippet: 'sa' },
			{ url: 'https://b.com/', title: 'B', site: 'b.com', snippet: 'S' }
		]);
	});

	it('strips bidirectional controls that could reorder a title or snippet', async () => {
		stub({
			google: ok(
				hit('https://a.com/', 'Alfonso Gonz\u00e1lez\u202c - \u202aScholar', 'a\u2066b\u2069')
			)
		});
		const [h] = await provider.search('q', 'google');
		expect([h.title, h.snippet]).toEqual(['Alfonso Gonz\u00e1lez - Scholar', 'ab']);
	});

	it('skips links that are not web URLs or cannot be parsed', async () => {
		stub({ google: ok(hit('javascript:alert(1)'), hit('https://['), hit('https://a.com/')) });
		const hits = await provider.search('q', 'google');
		expect(hits.map((h) => h.url)).toEqual(['https://a.com/']);
	});

	describe('Google redirect links', () => {
		/**
		 * Stubs SerpApi with Google results and Google's redirect hop.
		 * @param hits Google's organic results.
		 * @param pages Page each redirect path leads to; `down` fails the request, and unlisted paths
		 *   answer without a location.
		 */
		const google = (hits: ReturnType<typeof hit>[], pages: Record<string, string>) => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async (input: string | URL) => {
					const url = new URL(String(input));
					if (url.host === 'serpapi.com') return Response.json({ organic_results: hits });
					const page = pages[url.pathname + url.search];
					if (page === 'down') throw new TypeError('fetch failed');
					return new Response(null, page ? { status: 302, headers: { location: page } } : {});
				})
			);
		};

		it('follows every redirect link in rank order, even beside direct links', async () => {
			google(
				[hit('/goto?url=A'), hit('https://b.com/'), hit('https://c.com/'), hit('https://d.com/')],
				{ '/goto?url=A': 'https://a.com/obit' }
			);
			const hits = await provider.search('q', 'google');
			expect(hits.map((h) => [h.url, h.site])).toEqual([
				['https://a.com/obit', 'a.com'],
				['https://b.com/', 'b.com'],
				['https://c.com/', 'c.com'],
				['https://d.com/', 'd.com']
			]);
		});

		it('drops a redirect that fails or leads nowhere and keeps the rest', async () => {
			google([hit('/goto?url=A'), hit('/goto?url=B'), hit('/goto?url=C')], {
				'/goto?url=A': 'https://a.com/',
				'/goto?url=B': 'down',
				'/goto?url=C': 'javascript:alert(1)'
			});
			const hits = await provider.search('q', 'google');
			expect(hits.map((h) => h.url)).toEqual(['https://a.com/']);
		});

		it('treats an absolute Google redirect link as a hop, never as a page', async () => {
			const goto = 'https://www.google.com/goto?url=A';
			google([hit(goto), hit('https://b.com/'), hit('https://c.com/'), hit('https://d.com/')], {
				'/goto?url=A': 'https://a.com/'
			});
			expect((await provider.search('q', 'google')).map((h) => h.url)).not.toContain(goto);
			google([hit(goto), hit('https://b.com/')], { '/goto?url=A': 'https://a.com/' });
			expect((await provider.search('q', 'google')).map((h) => h.url)).toEqual([
				'https://a.com/',
				'https://b.com/'
			]);
		});

		it('drops a redirect that lands back on Google, such as a captcha page', async () => {
			google([hit('/goto?url=A'), hit('/goto?url=B')], {
				'/goto?url=A': 'https://www.google.com/sorry/index?continue=x',
				'/goto?url=B': 'https://b.com/'
			});
			expect((await provider.search('q', 'google')).map((h) => h.url)).toEqual(['https://b.com/']);
		});

		it('throws when every result is a redirect and none resolves', async () => {
			google([hit('/goto?url=A'), hit('/goto?url=B')], { '/goto?url=B': 'down' });
			await expect(provider.search('q', 'google')).rejects.toThrow('redirects did not resolve');
		});

		it('never follows a link that leaves Google', async () => {
			google([hit('//evil.com/goto?url=A')], { '/goto?url=A': 'https://a.com/' });
			expect(await provider.search('q', 'google')).toEqual([]);
		});

		it('never follows Yandex links', async () => {
			stub({ yandex: ok(hit('/goto?url=A')) });
			expect(await provider.search('q', 'yandex')).toEqual([]);
		});
	});
});
