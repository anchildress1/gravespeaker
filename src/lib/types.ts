/** Matches `YYYY` or `YYYY-MM-DD`, each digit `0-9` or `?`. */
export const PARTIAL_DATE = /^[0-9?]{4}(-[0-9?]{2}-[0-9?]{2})?$/;

/** One person read from a headstone, after normalization. */
export interface Inscription {
	carvedName: string;
	name: string;
	maidenName: string | null;
	born: string | null;
	died: string | null;
}

/** A search hit. */
export interface SourceRecord {
	id: string;
	url: string;
	title: string;
	site: string;
	snippet: string;
}

/** One hypothesized person with the records that support it. */
export interface Candidate {
	name: string;
	born: string | null;
	died: string | null;
	place: string | null;
	sources: SourceRecord[];
}

/** One sentence of a story. */
export interface StorySentence {
	text: string;
	kind: 'fact' | 'reconstruction';
	sourceIds: string[];
}

export type Story =
	| { status: 'told'; sentences: StorySentence[]; sources: SourceRecord[] }
	| { status: 'insufficient' };

export interface ApiError {
	error: {
		code: 'invalid_input' | 'unsupported_type' | 'too_large' | 'provider_failed';
		message: string;
	};
}
