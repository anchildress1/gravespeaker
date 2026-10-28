import { describe, expect, it } from 'vitest';
import { groundStory } from './narrative';
import type { RawSentence } from './inference/index';
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
	place: null,
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
 * Test helper.
 * @param over Test input.
 * @returns The fixture.
 */
const fact = (over: Partial<RawSentence>): RawSentence => ({
	text: 'I taught piano.',
	kind: 'fact',
	claim: 'other',
	sourceIds: ['s1'],
	quote: 'taught piano for forty years',
	...over
});

describe('groundStory', () => {
	it('keeps a fact whose quote is in the cited source', () => {
		const story = groundStory(stone, candidate, pages, [fact({})]);
		expect(story).toEqual({
			status: 'told',
			sentences: [{ text: 'I taught piano.', kind: 'fact', sourceIds: ['s1'] }],
			sources: [candidate.sources[0]]
		});
	});

	it('drops a fact citing a source outside the candidate', () => {
		expect(groundStory(stone, candidate, pages, [fact({ sourceIds: ['s9'] })])).toEqual({
			status: 'insufficient'
		});
	});

	it('drops a fact whose quote is absent from every cited source', () => {
		expect(groundStory(stone, candidate, pages, [fact({ sourceIds: ['s2'] })])).toEqual({
			status: 'insufficient'
		});
	});

	it('matches quotes ignoring case, punctuation and whitespace', () => {
		const story = groundStory(stone, candidate, pages, [
			fact({ quote: 'TAUGHT   piano, for forty years!' })
		]);
		expect(story.status).toBe('told');
	});

	it('clears sourceIds on a reconstruction', () => {
		const story = groundStory(stone, candidate, pages, [
			fact({}),
			{
				text: 'The wind remembers.',
				kind: 'reconstruction',
				claim: 'other',
				sourceIds: ['s1'],
				quote: ''
			}
		]);
		expect(story).toMatchObject({
			sentences: [{ kind: 'fact' }, { kind: 'reconstruction', sourceIds: [] }]
		});
	});

	it('is insufficient when only name, birth and death facts survive', () => {
		const story = groundStory(stone, candidate, pages, [
			fact({ claim: 'name', text: 'I am Gaynor Hawks.', quote: 'Gaynor Hawks' }),
			fact({ claim: 'birth', text: 'I was born March 10, 1932.', quote: 'born March 10, 1932' })
		]);
		expect(story).toEqual({ status: 'insufficient' });
	});

	it('does not count an "other" fact made only of name and date tokens', () => {
		const story = groundStory(stone, candidate, pages, [
			fact({ text: 'I am Gaynor Hawks, March 10, 1932.', quote: 'Gaynor Hawks, March 10, 1932' })
		]);
		expect(story).toEqual({ status: 'insufficient' });
	});

	it('counts one surviving "other" fact as enough', () => {
		expect(
			groundStory(stone, candidate, pages, [
				fact({ text: 'I loved gardening.', quote: 'She loved gardening' })
			]).status
		).toBe('told');
	});

	it('drops a sentence that invents a claim beside a real quote', () => {
		const story = groundStory(stone, candidate, pages, [
			fact({ text: 'I flew combat missions in the war.' })
		]);
		expect(story).toEqual({ status: 'insufficient' });
	});

	it('keeps a first-person, tense-shifted paraphrase of its quote', () => {
		const story = groundStory(stone, candidate, pages, [
			fact({ text: 'I taught piano for forty years.' })
		]);
		expect(story.status).toBe('told');
	});

	it('keeps a ghost-voice rewording that reuses the quoted proper noun', () => {
		const quote = 'preceded in death by her husband Arthur';
		const story = groundStory(
			stone,
			candidate,
			[{ sourceId: 's1', text: `Gaynor Hawks was ${quote}.` }],
			[fact({ text: 'I was preceded in death by my husband Arthur.', quote })]
		);
		expect(story.status).toBe('told');
	});

	it('drops a sentence that changes a quoted number', () => {
		const story = groundStory(stone, candidate, pages, [
			fact({ text: 'I taught piano for fifty years.' })
		]);
		expect(story).toEqual({ status: 'insufficient' });
	});

	it('drops a sentence that adds an unquoted proper noun', () => {
		const story = groundStory(stone, candidate, pages, [
			fact({ text: 'I taught piano in Paris.' })
		]);
		expect(story).toEqual({ status: 'insufficient' });
	});

	it('drops a sentence with no content words', () => {
		const story = groundStory(stone, candidate, pages, [fact({ text: 'I was there.' })]);
		expect(story).toEqual({ status: 'insufficient' });
	});

	it('exposes only text, kind and sourceIds, and only cited sources', () => {
		const story = groundStory(stone, candidate, pages, [fact({})]);
		if (story.status !== 'told') throw new Error('expected told');
		expect(Object.keys(story.sentences[0]).sort()).toEqual(['kind', 'sourceIds', 'text']);
		expect(story.sources.map((s) => s.id)).toEqual(['s1']);
	});

	it('drops a reconstruction that is only label debris', () => {
		const story = groundStory(stone, candidate, pages, [
			fact({ text: 'I loved gardening.', quote: 'She loved gardening' }),
			{ text: 'reconstruction:', kind: 'reconstruction', claim: 'other', sourceIds: [], quote: '' },
			{
				text: 'The fog keeps its own counsel.',
				kind: 'reconstruction',
				claim: 'other',
				sourceIds: [],
				quote: ''
			}
		]);
		if (story.status !== 'told') throw new Error('expected told');
		expect(story.sentences.map((s) => s.text)).toEqual([
			'I loved gardening.',
			'The fog keeps its own counsel.'
		]);
	});
});
