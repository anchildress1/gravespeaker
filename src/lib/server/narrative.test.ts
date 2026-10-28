import { describe, expect, it } from 'vitest';
import { groundParagraph, hasEvidence, verifyFacts } from './narrative';
import type { RawFact } from './inference/index';
import type { Candidate, Inscription } from '#lib/types.ts';

const stone: Inscription = {
	carvedName: 'Gaynor Claire Hawks',
	name: 'Gaynor Claire Hawks',
	maidenName: null,
	born: '1932-03-10',
	died: '2017-12-27'
};
const candidate: Candidate = {
	name: 'Gaynor Claire Hawks',
	born: '1932-03-10',
	died: '2017-12-27',
	confidence: 'high',
	sources: [
		{ id: 's1', url: 'https://a.test/1', title: 'A', site: 'a.test', snippet: '' },
		{ id: 's2', url: 'https://b.test/2', title: 'B', site: 'b.test', snippet: '' }
	]
};
const pages = [
	{
		sourceId: 's1',
		text: 'Gaynor Hawks, March 10, 1932, taught piano for forty years. She loved gardening.'
	},
	{ sourceId: 's2', text: 'Unrelated page about something else.' }
];

/**
 * Builds a raw fact, defaulting to a verifiable "other" fact.
 * @param over Fields to override.
 * @returns The fact.
 */
const fact = (over: Partial<RawFact> = {}): RawFact => ({
	claim: 'other',
	sourceId: 's1',
	quote: 'taught piano for forty years',
	...over
});

/**
 * Grounds a paragraph against the default piano fact and returns the told paragraph.
 * @param paragraph Prose to ground.
 * @param facts Facts the prose was written from.
 * @returns The kept paragraph, or null when the story was insufficient.
 */
const told = (paragraph: string, facts = [fact()]): string | null => {
	const story = groundParagraph(stone, candidate, facts, paragraph);
	return story.status === 'told' ? story.paragraph : null;
};

describe('hasEvidence', () => {
	it.each(['died December 27, 2017 at the age of 85 years', 'was born on March 10th, 1932'])(
		'does not count age or ordinal wording as extra biography: %s',
		(quote) => {
			expect(hasEvidence(stone, candidate, [fact({ quote })])).toBe(false);
		}
	);

	it('counts a birthplace in a birth quote but not the dates alone', () => {
		/**
		 * Checks a birth quote for evidence.
		 * @param quote Quote text.
		 * @returns Whether it counts as evidence.
		 */
		const birth = (quote: string) =>
			hasEvidence(stone, candidate, [fact({ claim: 'birth', quote })]);
		expect(birth('born March 10, 1932 in Alsea')).toBe(true);
		expect(birth('born March 10, 1932')).toBe(false);
	});

	it.each(['Gaynor Hawks was born in 1932', 'died on December 27, 2017', 'passed away at age 85'])(
		'does not count a quote that only restates the stone: %s',
		(quote) => {
			expect(hasEvidence(stone, candidate, [fact({ quote })])).toBe(false);
		}
	);

	it.each(['born March 10, 1932 in Alsea', 'was a chef', 'taught piano for forty years'])(
		'counts a quote that adds something beyond the stone: %s',
		(quote) => {
			expect(hasEvidence(stone, candidate, [fact({ quote })])).toBe(true);
		}
	);
});

describe('groundParagraph', () => {
	it.each([
		['taught piano for 24 years', 'I taught piano for twenty-four years.'],
		['taught piano for twenty-four years', 'I taught piano for 24 years.']
	])('treats a spelled-out compound number and its digits as one number: %s', (quote, prose) => {
		expect(told(prose, [fact({ quote })])).toContain('piano');
	});

	it('drops a negation of a fact made only of short words', () => {
		const facts = [fact({ quote: 'was a chef' })];
		expect(told('I was never a chef.', facts)).toBeNull();
		expect(told('I was a chef.', facts)).toContain('chef');
	});

	it('handles prose words that are also Object property names', () => {
		const facts = [fact({ quote: 'worked as a constructor' })];
		expect(() => told('I worked as a constructor.', facts)).not.toThrow();
		expect(told('I worked as a constructor.', facts)).toContain('constructor');
	});
});

describe('verifyFacts', () => {
	it('keeps a fact whose quote is in its cited source', () => {
		expect(verifyFacts(candidate, pages, [fact()])).toHaveLength(1);
	});

	it('drops a fact whose quote is not in the cited source', () => {
		expect(verifyFacts(candidate, pages, [fact({ quote: 'flew combat missions' })])).toEqual([]);
		expect(verifyFacts(candidate, pages, [fact({ sourceId: 's2' })])).toEqual([]);
	});

	it.each(['her husband John', 'John, her husband', 'survived by two sons, Mark and Paul'])(
		'drops a quote that names a relative: %s',
		(quote) => {
			const text = [
				{ sourceId: 's1', text: `Gaynor taught piano. Services: ${quote}, and friends.` }
			];
			expect(verifyFacts(candidate, text, [fact({ quote })])).toEqual([]);
		}
	);

	it('keeps a quote about an unnamed relative', () => {
		const quote = 'She married her husband in 1956';
		const text = [{ sourceId: 's1', text: `Gaynor taught piano. ${quote}.` }];
		expect(verifyFacts(candidate, text, [fact({ quote })])).toHaveLength(1);
	});

	it('keeps a relative named in a quote that says they died first', () => {
		const quote = 'her husband John predeceased her';
		const text = [{ sourceId: 's1', text: `Gaynor taught piano; ${quote}.` }];
		expect(verifyFacts(candidate, text, [fact({ quote })])).toHaveLength(1);
	});

	it('drops a fact citing a source outside the candidate', () => {
		expect(verifyFacts(candidate, pages, [fact({ sourceId: 's9' })])).toEqual([]);
	});

	it('matches ignoring case, punctuation and whitespace', () => {
		const loose = fact({ quote: 'TAUGHT   piano, for forty years!' });
		expect(verifyFacts(candidate, pages, [loose])).toHaveLength(1);
	});

	it('drops a repeated quote', () => {
		expect(verifyFacts(candidate, pages, [fact(), fact()])).toHaveLength(1);
	});

	it('drops a fact that names survivors, even when it is in the source', () => {
		const obit = [{ sourceId: 's1', text: 'She is survived by her wife Jane and son Mark.' }];
		const survivors = fact({ quote: 'survived by her wife Jane and son Mark' });
		expect(verifyFacts(candidate, obit, [survivors])).toEqual([]);
	});

	it('drops an empty quote', () => {
		expect(verifyFacts(candidate, pages, [fact({ quote: '' })])).toEqual([]);
	});
});

describe('hasEvidence', () => {
	it('is false for facts that only repeat the name and dates', () => {
		const facts = [
			fact({ claim: 'name', quote: 'Gaynor Hawks' }),
			fact({ claim: 'other', quote: 'Gaynor Hawks, March 10, 1932' })
		];
		expect(hasEvidence(stone, candidate, facts)).toBe(false);
	});

	it('is true for one fact with real content', () => {
		expect(hasEvidence(stone, candidate, [fact()])).toBe(true);
	});

	it('is false for no facts', () => {
		expect(hasEvidence(stone, candidate, [])).toBe(false);
	});
});

describe('groundParagraph', () => {
	it('is insufficient when there is no real fact to build on', () => {
		const dates = [fact({ claim: 'birth', quote: 'March 10, 1932' })];
		expect(groundParagraph(stone, candidate, dates, 'I was born long ago.')).toEqual({
			status: 'insufficient'
		});
	});

	it('keeps atmosphere and facts together, and cites only the sources it used', () => {
		const story = groundParagraph(
			stone,
			candidate,
			[fact(), fact({ sourceId: 's2', quote: 'something else entirely' })],
			'Come closer, the cold is patient. I taught piano for forty years. The silence has no keys.'
		);
		if (story.status !== 'told') throw new Error('expected told');
		expect(story.paragraph).toContain('Come closer');
		expect(story.paragraph).toContain('piano');
		expect(story.paragraph).toContain('silence');
		expect(story.sources.map((s) => s.id)).toEqual(['s1']);
	});

	it('is insufficient when the story ignores the facts', () => {
		expect(told('The fog keeps its counsel. The moon is thin tonight.')).toBeNull();
	});

	it('drops a sentence with a number the facts do not give', () => {
		const out = told('I taught piano for forty years. I lived to be 99 years old.');
		expect(out).toContain('piano');
		expect(out).not.toContain('99');
	});

	it('accepts a number word where the source writes the digits, and the reverse', () => {
		const digits = [fact({ quote: 'taught piano for 40 years' })];
		expect(told('I taught piano for forty years.', digits)).toContain('forty');
		const words = [fact({ quote: 'taught piano for forty years' })];
		expect(told('I taught piano for 40 years.', words)).toContain('40');
	});

	it('drops a sentence that names someone the facts do not name', () => {
		const out = told('I taught piano for forty years. My friend Margaret wept here.');
		expect(out).toContain('piano');
		expect(out).not.toContain('Margaret');
	});

	it("allows the person's own name and months without a quote", () => {
		expect(told('Call me Gaynor, born in March. I taught piano for forty years.')).toContain(
			'Gaynor'
		);
	});

	it('drops a negation that touches a fact but keeps one that is only atmosphere', () => {
		const out = told('I never taught piano for forty years. The silence here has no end.');
		expect(out).toBeNull();
		const both = told(
			'I taught piano for forty years. I never taught piano for fifty years. The silence has no end.'
		);
		expect(both).toContain('silence');
		expect(both).not.toContain('never');
	});

	it('counts a fact made only of short words as used when the story repeats it', () => {
		const short = [fact({ quote: 'was a chef' })];
		expect(told('I was a chef.', short)).toBe('I was a chef.');
		expect(told('The garden was quiet in spring.', short)).toBeNull();
	});

	it('drops a sentence the model repeats', () => {
		const out = told(
			'The fog keeps its counsel. I taught piano for forty years. The fog keeps its counsel.'
		);
		expect(out!.split('fog keeps')).toHaveLength(2);
	});

	it('returns only the paragraph and the cited sources', () => {
		const story = groundParagraph(stone, candidate, [fact()], 'I taught piano for forty years.');
		expect(Object.keys(story).sort()).toEqual(['paragraph', 'sources', 'status']);
	});
});
