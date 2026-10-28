export interface Engine {
	engine: string;
	/** SerpApi names the query parameter differently per engine. */
	queryParam: string;
	extra?: Record<string, string>;
}

/**
 * Engines that return organic results as link, title and snippet. Order sets the result order.
 * Kept after benchmarks/results/search-1.json: Bing returned 94 results and no match and was the
 * slowest engine, and DuckDuckGo returned one result in ten stones.
 */
export const ENGINES: Engine[] = [
	{ engine: 'google', queryParam: 'q', extra: { num: '10', gl: 'us', hl: 'en' } },
	{ engine: 'yahoo', queryParam: 'p' },
	{ engine: 'yandex', queryParam: 'text' }
];
