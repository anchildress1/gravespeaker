import { partialDateOrNull, VOICES } from '#lib/types.ts';
import type { Inscription } from '#lib/types.ts';
import type { RawPerson } from './inference/index.ts';

const HONORIFIC = /^(?:mr|mrs|miss|dr)\.?(?=\s)/i;
// The clause with any enclosing parenthesis, so "(née Staples)" leaves no stray bracket behind.
const MAIDEN = /\(?\b(?:née|nee)\s+([\p{L}'’-]+)\)?/iu;
// Generational suffixes, kept in capitals only after the first word so a first name like "Vi" isn't.
const ROMAN = /^(?:II|III|IV|V|VI|VII|VIII|IX|X)$/;

/**
 * Title-cases a name carved in capitals; a name carved in mixed case is left as carved.
 * @param name Name with honorifics and maiden clause already removed.
 * @returns The name as it should read on screen and in the story.
 */
function displayCase(name: string): string {
	// Mixed-case carvings already carry the family's spelling (McDonald, van Buren); don't guess.
	if (/\p{Ll}/u.test(name)) return name;
	return name
		.split(' ')
		.map((word, i) =>
			i > 0 && ROMAN.test(word)
				? word
				: word
						.toLowerCase()
						.replace(/(^|[^\p{L}])(\p{L})/gu, (_, edge, letter) => edge + letter.toUpperCase())
						// Mc always capitalizes what follows; Mac does not (Mack, Macy), so it is left alone.
						.replace(/^Mc(\p{L})/u, (_, letter) => 'Mc' + letter.toUpperCase())
		)
		.join(' ');
}

/**
 * Turns model output into inscriptions: drops letterless names, strips honorifics, splits `née`,
 * title-cases all-caps carvings, validates dates.
 * @param raw People as the model returned them.
 * @returns Normalized people; empty when no name is legible.
 */
export function normalizeInscriptions(raw: RawPerson[]): Inscription[] {
	const people: Inscription[] = [];
	for (const p of raw) {
		if (!/\p{L}/u.test(p.name ?? '')) continue;
		const carvedName = p.name.trim();
		const maiden = MAIDEN.exec(carvedName)?.[1];
		const name = carvedName.replace(MAIDEN, ' ').replace(HONORIFIC, '').replace(/\s+/g, ' ').trim();
		people.push({
			carvedName,
			// Display fonts draw a straight " as a closing quote, so "Cory" would open backwards.
			name: displayCase(name)
				.replace(/"([^"]+)"/g, '“$1”')
				.replace(/"(?=\S)/g, '“')
				.replaceAll('"', '”'),
			maidenName: maiden ? displayCase(maiden) : null,
			born: partialDateOrNull(p.born),
			died: partialDateOrNull(p.died),
			voice: VOICES.find((v) => v === p.voice?.toLowerCase()) ?? null
		});
	}
	return people;
}
