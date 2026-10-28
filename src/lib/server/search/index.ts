import type { SourceRecord } from '#lib/types.ts';

/** Historical search seam. */
export interface SearchProvider {
	/**
	 * Runs one web search.
	 * @param query Search query.
	 * @returns Hits with ids `s1…sN`.
	 * @throws {ProviderError} When the provider fails after retries.
	 */
	search(query: string): Promise<SourceRecord[]>;
}
