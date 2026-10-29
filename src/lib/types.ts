/** Matches `YYYY` or `YYYY-MM-DD`, each digit `0-9` or `?`. */
export const PARTIAL_DATE = /^[0-9?]{4}(-[0-9?]{2}-[0-9?]{2})?$/;

/**
 * Keeps a date only if it is `YYYY` or `YYYY-MM-DD` with `?` for unreadable digits and a real
 * month and day.
 * @param value Date as a model returned it.
 * @returns The date, or null when absent or malformed.
 */
export function partialDateOrNull(value: string | null | undefined): string | null {
	if (!value || !PARTIAL_DATE.test(value)) return null;
	// A month or day with no unreadable digit must be a real one: "1932-13-45" is a misread.
	const [, month, day] = value.split('-');
	if (month && !month.includes('?') && (+month < 1 || +month > 12)) return null;
	if (day && !day.includes('?') && (+day < 1 || +day > 31)) return null;
	return value;
}

/** Narrator voices. A guess only picks who reads the story; it is never a fact about the person. */
export const VOICES = ['female', 'male'] as const;
export type Voice = (typeof VOICES)[number];

/** One person read from a headstone, after normalization. */
export interface Inscription {
	carvedName: string;
	name: string;
	maidenName: string | null;
	born: string | null;
	died: string | null;
	/** The model's narrator guess from the name; null when the name gives no hint. */
	voice: Voice | null;
}

/** A search hit. */
export interface SourceRecord {
	id: string;
	url: string;
	title: string;
	site: string;
	snippet: string;
}

/** How sure the match is that the records are about the stone's person. */
export type Confidence = 'high' | 'medium' | 'low';

/** One hypothesized person with the records that support it. */
export interface Candidate {
	name: string;
	born: string | null;
	died: string | null;
	confidence: Confidence;
	sources: SourceRecord[];
}

/**
 * A story told from the confirmed records, or from the stone alone when there are none to use.
 * A stone story's paragraph is null when none of the model's sentences survived grounding.
 */
export type Story =
	| { status: 'told'; paragraph: string; sources: SourceRecord[]; voice: Voice }
	| { status: 'stone'; paragraph: string | null; voice: Voice };

export interface ApiError {
	error: {
		code: 'invalid_input' | 'unsupported_type' | 'too_large' | 'provider_failed';
		message: string;
	};
}
