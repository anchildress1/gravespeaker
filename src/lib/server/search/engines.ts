export interface Engine {
	engine: string;
	/** SerpApi names the query parameter differently per engine. */
	queryParam: string;
	extra?: Record<string, string>;
	/** Origin that answers the engine's relative result links with a redirect to the page. */
	redirects?: string;
}

/**
 * Engines that return organic results as link, title and snippet, in the order research tries them.
 */
// Yandex leads: it returns more results per query, and Google rarely dates a match without a town.
export const ENGINES: Engine[] = [
	{ engine: 'yandex', queryParam: 'text' },
	{
		engine: 'google',
		queryParam: 'q',
		extra: { num: '10', gl: 'us', hl: 'en' },
		// Since October 2026 Google links most results through /goto, which SerpApi passes on as-is.
		redirects: 'https://www.google.com'
	}
];
