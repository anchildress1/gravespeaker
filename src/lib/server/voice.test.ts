import { describe, expect, it } from 'vitest';
import type { Inscription, Voice } from '#lib/types.ts';
import { narratorVoice } from './voice';

/**
 * Test helper.
 * @param voice The name-based guess.
 * @returns An inscription carrying the guess.
 */
const stone = (voice: Voice | null): Inscription => ({
	carvedName: 'Robin Ash',
	name: 'Robin Ash',
	maidenName: null,
	born: null,
	died: null,
	voice
});

describe('narratorVoice', () => {
	it('follows pronouns in the facts over the name guess', () => {
		expect(narratorVoice(stone('male'), ['She taught piano for forty years'])).toBe('female');
		expect(narratorVoice(stone('female'), ['He served in the Navy'])).toBe('male');
	});

	it('reads "X of" relationship words as the subject', () => {
		expect(narratorVoice(stone(null), ['beloved wife of John Ash'])).toBe('female');
		expect(narratorVoice(stone(null), ['son of Mary and Tom Ash'])).toBe('male');
	});

	it('does not count a relative named after a pronoun as the subject', () => {
		expect(narratorVoice(stone('male'), ['survived by her husband'])).toBe('female');
	});

	it('matches whole words only', () => {
		expect(narratorVoice(stone('female'), ['the shepherd lived in Hershey'])).toBe('female');
	});

	it('takes the majority across all quotes', () => {
		expect(
			narratorVoice(stone(null), ['He farmed wheat', 'his barn burned', 'married her in 1950'])
		).toBe('male');
	});

	it('falls back to the name guess on a tie or no cues', () => {
		expect(narratorVoice(stone('male'), ['his wife and her sister'])).toBe('male');
		expect(narratorVoice(stone('male'), [])).toBe('male');
	});

	it('picks a voice even with no cue and no name guess', () => {
		expect(narratorVoice(stone(null), ['taught piano'])).toBe('female');
	});
});
