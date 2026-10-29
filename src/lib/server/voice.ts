import type { Inscription, Voice } from '#lib/types.ts';

// Pronouns describe the subject of a fact; a relationship word only does when followed by "of":
// "wife of John" is about her, while "survived by her husband" names someone else.
const CUES: Record<Voice, RegExp> = {
	female:
		/\b(?:she|her|hers|herself|(?:wife|mother|daughter|sister|grandmother|aunt|widow|niece|granddaughter) of)\b/gi,
	male: /\b(?:he|him|his|himself|(?:husband|father|son|brother|grandfather|uncle|widower|nephew|grandson) of)\b/gi
};

// Arbitrary: a stone with no usable cue still needs a narrator, and the visitor can switch it.
const FALLBACK: Voice = 'female';

/**
 * Picks the narrator voice from verified fact quotes first, then the name-based guess.
 * @param inscription The stone's person, carrying the name-based guess.
 * @param quotes Verified fact quotes about the person.
 * @returns The voice with more cues in the quotes; on a tie, the name guess or a fallback.
 */
export function narratorVoice(inscription: Inscription, quotes: string[]): Voice {
	const text = quotes.join(' ');
	const female = [...text.matchAll(CUES.female)].length;
	const male = [...text.matchAll(CUES.male)].length;
	if (female !== male) return female > male ? 'female' : 'male';
	return inscription.voice ?? FALLBACK;
}
