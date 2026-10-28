import type { Candidate, Inscription, SourceRecord } from '#lib/types.ts';

export interface RawPerson {
	name: string;
	born: string | null;
	died: string | null;
}

export interface RawCandidate {
	name: string;
	born: string | null;
	died: string | null;
	place: string | null;
	resultIds: string[];
}

export interface RawSentence {
	text: string;
	kind: 'fact' | 'reconstruction';
	claim: 'name' | 'birth' | 'death' | 'other';
	sourceIds: string[];
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
	 * Groups search hits into distinct people.
	 * @param inscription The stone's person.
	 * @param records Search hits.
	 * @returns Raw candidate groups.
	 * @throws {ProviderError} When the model fails after retries.
	 */
	groupCandidates(inscription: Inscription, records: SourceRecord[]): Promise<RawCandidate[]>;
	/**
	 * Writes a first-person story from cited page text.
	 * @param inscription The stone's person.
	 * @param candidate The confirmed candidate.
	 * @param pages Extracted text per source.
	 * @returns Raw sentences with claims and quotes.
	 * @throws {ProviderError} When the model fails after retries.
	 */
	tellStory(
		inscription: Inscription,
		candidate: Candidate,
		pages: PageText[]
	): Promise<RawSentence[]>;
}
