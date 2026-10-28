import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../http';

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
	it('treats scheme, www, trailing slash, query and hash as the same page', () => {
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

	it('keeps different pages apart and rejects non-web links', () => {
		expect(canonicalUrl('https://a.com/x')).not.toBe(canonicalUrl('https://a.com/y'));
		expect(canonicalUrl('javascript:alert(1)')).toBeNull();
		expect(canonicalUrl('https://[')).toBeNull();
	});
});

describe('SerpApiProvider', () => {
	it('searches several engines in parallel and merges their results', async () => {
		const fn = stub({
			google: ok(hit('https://a.com/1')),
			yandex: ok(hit('https://b.com/2')),
			yahoo: ok(hit('https://c.com/3'))
		});
		const hits = await new SerpApiProvider().search('q');
		expect(hits.map((h) => h.url)).toEqual([
			'https://a.com/1',
			'https://b.com/2',
			'https://c.com/3'
		]);
		const engines = fn.mock.calls.map(([u]) => new URL(String(u)).searchParams.get('engine'));
		expect(new Set(engines)).toEqual(new Set(['google', 'yandex', 'yahoo']));
	});

	it('removes a page that several engines return, keeping the first', async () => {
		stub({
			google: ok(hit('https://www.a.com/1/', 'First')),
			yandex: ok(hit('https://a.com/1', 'Second'), hit('https://b.com/2'))
		});
		const hits = await new SerpApiProvider().search('q');
		expect(hits.map((h) => h.title)).toEqual(['First', 'T']);
		expect(hits.map((h) => h.id)).toEqual(['s1', 's2']);
	});

	it('uses the engines that answered when another one fails', async () => {
		stub({ google: down, yandex: ok(hit('https://b.com/2')) });
		expect(await new SerpApiProvider().search('q')).toHaveLength(1);
	});

	it('returns an empty list when engines report no results', async () => {
		stub({
			google: () => Response.json({ error: "Google hasn't returned any results for this query." })
		});
		expect(await new SerpApiProvider().search('q')).toEqual([]);
	});

	it('throws ProviderError only when every engine fails', async () => {
		stub({ google: down, yahoo: down, yandex: down });
		await expect(new SerpApiProvider().search('q')).rejects.toBeInstanceOf(ProviderError);
	});

	it('maps hits to numbered records with the hostname as site', async () => {
		stub({ google: ok(hit('https://www.legacy.com/a', 'A', 'sa')) });
		expect(await new SerpApiProvider().search('q')).toEqual([
			{
				id: 's1',
				url: 'https://www.legacy.com/a',
				title: 'A',
				site: 'www.legacy.com',
				snippet: 'sa'
			}
		]);
	});

	it('skips links that are not web URLs or cannot be parsed', async () => {
		stub({ google: ok(hit('javascript:alert(1)'), hit('https://['), hit('https://a.com/')) });
		const hits = await new SerpApiProvider().search('q');
		expect(hits.map((h) => h.url)).toEqual(['https://a.com/']);
	});
});
