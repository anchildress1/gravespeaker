import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../http';

vi.mock('../env', () => ({ geminiApiKey: () => 'test', serpApiKey: () => 'test' }));

const { SerpApiProvider } = await import('./serpapi');

/**
 * Stubs the SerpApi boundary.
 * @param status HTTP status.
 * @param body JSON body.
 * @returns The fixture.
 */
const stub = (status: number, body: unknown) =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json(body, { status }))
	);

afterEach(() => vi.unstubAllGlobals());

describe('SerpApiProvider', () => {
	it('maps organic results to numbered source records', async () => {
		stub(200, {
			organic_results: [
				{ link: 'https://www.legacy.com/a', title: 'A', snippet: 'sa' },
				{ link: 'https://findagrave.com/b', title: 'B', snippet: 'sb' }
			]
		});
		expect(await new SerpApiProvider().search('q')).toEqual([
			{
				id: 's1',
				url: 'https://www.legacy.com/a',
				title: 'A',
				site: 'www.legacy.com',
				snippet: 'sa'
			},
			{
				id: 's2',
				url: 'https://findagrave.com/b',
				title: 'B',
				site: 'findagrave.com',
				snippet: 'sb'
			}
		]);
	});

	it('returns an empty list when there are no organic results', async () => {
		stub(200, { search_metadata: {} });
		expect(await new SerpApiProvider().search('q')).toEqual([]);
	});

	it("treats SerpApi's no-results error as an empty list", async () => {
		stub(200, { error: "Google hasn't returned any results for this query." });
		expect(await new SerpApiProvider().search('q')).toEqual([]);
	});

	it('drops non-http links', async () => {
		stub(200, {
			organic_results: [{ link: 'javascript:alert(1)', title: 'x' }, { link: 'https://a.com/' }]
		});
		const hits = await new SerpApiProvider().search('q');
		expect(hits.map((h) => h.url)).toEqual(['https://a.com/']);
		expect(hits[0].id).toBe('s1');
	});

	it('throws ProviderError on an error response', async () => {
		stub(401, { error: 'Invalid API key' });
		await expect(new SerpApiProvider().search('q')).rejects.toBeInstanceOf(ProviderError);
	});
});
