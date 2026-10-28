import { serpApiKey } from '../env.ts';
import { ProviderError } from '../http.ts';
import type { SourceRecord } from '#lib/types.ts';
import type { SearchProvider } from './index.ts';
import { ENGINES, type Engine } from './engines.ts';
import { canonicalUrl } from './url.ts';

interface OrganicResult {
	link?: string;
	title?: string;
	snippet?: string;
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
	const body: { organic_results?: OrganicResult[]; error?: string } = await res.json();
	// SerpApi reports an empty result set as an error string.
	if (body.error?.includes("hasn't returned any results")) return [];
	if (!res.ok || body.error) throw new Error(body.error ?? `SerpApi ${res.status}`);
	return body.organic_results ?? [];
}

/** Web search through SerpApi: every engine in parallel, merged and deduplicated by URL. */
export class SerpApiProvider implements SearchProvider {
	/** @inheritdoc */
	async search(query: string): Promise<SourceRecord[]> {
		const settled = await Promise.allSettled(ENGINES.map((e) => searchEngine(e, query)));
		// One engine failing is normal; losing every engine is a provider failure.
		if (settled.every((r) => r.status === 'rejected')) {
			throw new ProviderError('Search failed', {
				cause: (settled[0] as PromiseRejectedResult).reason
			});
		}
		const records: SourceRecord[] = [];
		const seen = new Set<string>();
		for (const r of settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))) {
			const key = r.link ? canonicalUrl(r.link) : null;
			if (!key || seen.has(key)) continue;
			seen.add(key);
			records.push({
				id: `s${records.length + 1}`,
				url: r.link!,
				title: r.title ?? '',
				site: URL.parse(r.link!)!.hostname,
				snippet: r.snippet ?? ''
			});
		}
		return records;
	}
}

export const search: SearchProvider = new SerpApiProvider();
