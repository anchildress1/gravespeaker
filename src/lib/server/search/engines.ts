export interface Engine {
	engine: string;
	/** SerpApi names the query parameter differently per engine. */
	queryParam: string;
	extra?: Record<string, string>;
}

/**
 * Engines that return organic results as link, title and snippet. Order sets the result order.
 * Kept after benchmarks/results/search-1.json: Google and Yandex found 31 of the 35 kept sources and
 * 29 of the 31 found by one engine only. Yahoo added little at the slowest speed of the three, Bing
 * returned 94 results and no match, and DuckDuckGo returned one result in ten stones.
 */
export const ENGINES: Engine[] = [
	{ engine: 'google', queryParam: 'q', extra: { num: '10', gl: 'us', hl: 'en' } },
	{ engine: 'yandex', queryParam: 'text' }
];
