import { serpApiKey } from '../env.ts';
import { ProviderError } from '../http.ts';
import type { SourceRecord } from '#lib/types.ts';
import type { SearchProvider } from './index.ts';

interface OrganicResult {
	link?: string;
	title?: string;
	snippet?: string;
}

/** Google web search through SerpApi. */
export class SerpApiProvider implements SearchProvider {
	/** @inheritdoc */
	async search(query: string): Promise<SourceRecord[]> {
		const url = new URL('https://serpapi.com/search.json');
		url.search = new URLSearchParams({
			engine: 'google',
			q: query,
			num: '10',
			gl: 'us',
			hl: 'en',
			api_key: serpApiKey()
		}).toString();
		let body: { organic_results?: OrganicResult[]; error?: string };
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
			body = await res.json();
			// SerpApi reports an empty result set as an error string.
			if (body.error?.includes("hasn't returned any results")) return [];
			if (!res.ok || body.error) throw new Error(body.error ?? `SerpApi ${res.status}`);
		} catch (e) {
			throw new ProviderError('Search failed', { cause: e });
		}
		const records: SourceRecord[] = [];
		for (const r of body.organic_results ?? []) {
			if (!r.link || !/^https?:\/\//i.test(r.link)) continue;
			records.push({
				id: `s${records.length + 1}`,
				url: r.link,
				title: r.title ?? '',
				site: new URL(r.link).hostname,
				snippet: r.snippet ?? ''
			});
		}
		return records;
	}
}

export const search: SearchProvider = new SerpApiProvider();
