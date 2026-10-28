export interface Engine {
	engine: string;
	/** SerpApi names the query parameter differently per engine. */
	queryParam: string;
	extra?: Record<string, string>;
}

/** Engines that return organic results as link, title and snippet. Order sets the result order. */
export const ENGINES: Engine[] = [
	{ engine: 'google', queryParam: 'q', extra: { num: '10', gl: 'us', hl: 'en' } },
	{ engine: 'bing', queryParam: 'q' },
	{ engine: 'yahoo', queryParam: 'p' },
	{ engine: 'duckduckgo', queryParam: 'q' },
	{ engine: 'yandex', queryParam: 'text' }
];
