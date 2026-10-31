import { serpApiKey } from '../env.ts';
import type { SearchHit, SearchProvider } from './index.ts';
import { ENGINES, type Engine } from './engines.ts';
import { canonicalUrl } from './url.ts';

interface OrganicResult {
	link?: string;
	title?: string;
	snippet?: string;
}

// Bidi embedding, override and isolate controls can make a source title read differently on screen.
const BIDI = /[\u202a-\u202e\u2066-\u2069]/g;

/**
 * Removes bidirectional control characters from result text.
 * @param text Title or snippet from a search result.
 * @returns The text without them.
 */
const stripBidi = (text = '') => text.replaceAll(BIDI, '');

/**
 * Follows one redirect link to the page it leads to.
 * @param origin Origin that serves the engine's redirects.
 * @param link Result link on that origin, relative or absolute.
 * @returns The page URL, or null when the link does not redirect, the request fails, or it lands
 *   back on the origin, such as a captcha page.
 */
async function follow(origin: string, link: string): Promise<string | null> {
	try {
		const res = await fetch(new URL(link, origin), {
			redirect: 'manual',
			signal: AbortSignal.timeout(5_000)
		});
		const location = res.headers.get('location');
		return location && URL.parse(location, origin)?.origin !== origin ? location : null;
	} catch {
		// A redirect that fails costs only that result, the same as a link that never resolved.
		return null;
	}
}

/**
 * Runs one engine through SerpApi.
 * @param e Engine settings.
 * @param query Search query.
 * @returns The engine's organic results; none when it reports an empty result set.
 * @throws {Error} When the request fails.
 */
async function searchEngine(e: Engine, query: string): Promise<OrganicResult[]> {
	const url = new URL('https://serpapi.com/search.json');
	url.search = new URLSearchParams({
		engine: e.engine,
		[e.queryParam]: query,
		...e.extra,
		api_key: serpApiKey()
	}).toString();
	const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
	// A gateway error can answer with HTML; keep its status rather than a JSON parse error.
	const body: { organic_results?: OrganicResult[]; error?: string } = await res
		.json()
		.catch(() => ({}));
	// SerpApi reports an empty result set as an error string.
	if (body.error?.includes("hasn't returned any results")) return [];
	if (!res.ok || body.error) throw new Error(body.error ?? `SerpApi ${res.status}`);
	if (!body.organic_results) throw new Error('SerpApi answered without results or an error');
	return body.organic_results;
}

/** Web search through SerpApi, one engine per call. */
export class SerpApiProvider implements SearchProvider {
	readonly engines = ENGINES.map((e) => e.engine);

	/** @inheritdoc */
	async search(query: string, engine: string): Promise<SearchHit[]> {
		const e = ENGINES.find((x) => x.engine === engine);
		if (!e) throw new Error(`Unknown engine ${engine}`);
		const results = await searchEngine(e, query);
		const { redirects } = e;
		// A link on the engine's redirect origin, relative or absolute, is a hop and never a page.
		const hops = results.map(
			(r) => !!redirects && !!r.link && URL.parse(r.link, redirects)?.origin === redirects
		);
		// Every hop is followed: it costs a request, never a SerpApi credit.
		const links = await Promise.all(
			results.map((r, i) => {
				if (hops[i]) return follow(redirects!, r.link!);
				return Promise.resolve(r.link && canonicalUrl(r.link) ? r.link : null);
			})
		);
		// Every result a hop and none resolving means the redirects are down, not an empty search.
		if (hops.length && hops.every(Boolean) && !links.some(Boolean))
			throw new Error(`${engine} redirects did not resolve`);
		return results.flatMap((r, i) => {
			const url = links[i];
			return url && canonicalUrl(url)
				? [
						{
							url,
							title: stripBidi(r.title),
							site: URL.parse(url)!.hostname,
							snippet: stripBidi(r.snippet)
						}
					]
				: [];
		});
	}
}

export const search: SearchProvider = new SerpApiProvider();
