import type { Candidate, Confidence, Inscription, SourceRecord } from '#lib/types.ts';

export interface RawPerson {
	name: string;
	born: string | null;
	died: string | null;
}

export interface RawMatch {
	id: string;
	born: string | null;
	died: string | null;
	place: string | null;
	confidence: Confidence;
}

export interface RawFact {
	claim: 'name' | 'birth' | 'death' | 'other';
	sourceId: string;
	quote: string;
}

export interface PageText {
	sourceId: string;
	text: string;
}

/** Model inference seam. Outputs are unvalidated; deterministic code owns the format. */
export interface InferenceProvider {
	/**
	 * Reads the people commemorated on a headstone photo.
	 * @param image Image bytes.
	 * @param mimeType Image MIME type.
	 * @returns Raw people as the model returned them.
	 * @throws {ProviderError} When the model fails after retries.
	 */
	readStone(image: Uint8Array, mimeType: string): Promise<RawPerson[]>;
	/**
	 * Picks the search hits that are about the stone's person.
	 * @param inscription The stone's person.
	 * @param records Search hits.
	 * @returns The picked hits, each with the details it states.
	 * @throws {ProviderError} When the model fails after retries.
	 */
	pickMatches(inscription: Inscription, records: SourceRecord[]): Promise<RawMatch[]>;
	/**
	 * Pulls facts about the person out of source text, each as a verbatim quote.
	 * @param inscription The stone's person.
	 * @param candidate The confirmed candidate.
	 * @param pages Extracted text per source.
	 * @returns Raw facts as the model returned them.
	 * @throws {ProviderError} When the model fails after retries.
	 */
	extractFacts(
		inscription: Inscription,
		candidate: Candidate,
		pages: PageText[]
	): Promise<RawFact[]>;
	/**
	 * Writes one theatrical first-person paragraph around verified facts.
	 * @param name The deceased's name.
	 * @param facts Verified fact quotes the paragraph may use.
	 * @returns The paragraph as the model wrote it.
	 * @throws {ProviderError} When the model fails after retries.
	 */
	tellStory(name: string, facts: string[]): Promise<string>;
}
