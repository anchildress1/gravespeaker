import type { SourceRecord } from '#lib/types.ts';

/** A search hit before it is numbered into a research run. */
export type SearchHit = Omit<SourceRecord, 'id'>;

/** Historical search seam. */
export interface SearchProvider {
	/** Engines in the order to try them; a later one runs only when the earlier ones miss. */
	readonly engines: readonly string[];
	/**
	 * Runs one web search on one engine.
	 * @param query Search query.
	 * @param engine One of `engines`.
	 * @returns Hits in the engine's rank order.
	 * @throws {Error} When the request fails.
	 */
	search(query: string, engine: string): Promise<SearchHit[]>;
}
