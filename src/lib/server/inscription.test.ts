import { describe, expect, it } from 'vitest';
import { normalizeInscriptions } from './inscription';

/**
 * Test helper.
 * @param name Test input.
 * @param born Test input.
 * @param died Test input.
 * @param voice Test input.
 * @returns The fixture.
 */
const person = (
	name: string,
	born: string | null = null,
	died: string | null = null,
	voice: string | null = null
) => ({ name, born, died, voice });

describe('normalizeInscriptions', () => {
	it.each(['[]', '[?]'])('drops a person whose name %s has no letters', (name) => {
		expect(normalizeInscriptions([person(name, '1900', '1950')])).toEqual([]);
	});

	it('splits a maiden name and keeps the carved text', () => {
		const [p] = normalizeInscriptions([person('Gaynor Claire Hawks née Staples')]);
		expect(p).toMatchObject({
			name: 'Gaynor Claire Hawks',
			maidenName: 'Staples',
			carvedName: 'Gaynor Claire Hawks née Staples'
		});
	});

	it('removes a parenthesized maiden-name clause whole', () => {
		const [p] = normalizeInscriptions([person('Gaynor Hawks (née Staples)')]);
		expect([p.name, p.maidenName]).toEqual(['Gaynor Hawks', 'Staples']);
	});

	it('handles nee without the accent', () => {
		const [p] = normalizeInscriptions([person('Ann Lee nee Park')]);
		expect(p).toMatchObject({ name: 'Ann Lee', maidenName: 'Park' });
	});

	it.each([
		['Mr Andrew Morgan', 'Andrew Morgan'],
		['Dr. Jane Roe', 'Jane Roe'],
		['MRS Ada Cole', 'Ada Cole']
	])('drops the honorific in %s', (input, name) => {
		expect(normalizeInscriptions([person(input)])[0].name).toBe(name);
	});

	it('keeps an unreadable month or day', () => {
		const [p] = normalizeInscriptions([person('A B', '1932-??-10', '1932-05-??')]);
		expect(p).toMatchObject({ born: '1932-??-10', died: '1932-05-??' });
	});

	it('keeps partially unreadable and full dates', () => {
		const [p] = normalizeInscriptions([person('A B', '18?8', '1932-03-10')]);
		expect(p).toMatchObject({ born: '18?8', died: '1932-03-10' });
	});

	it.each(['March 1941', '19', '1941-03', '', '1932-13-10', '1932-00-10', '1932-05-45'])(
		'maps the bad date %j to null',
		(bad) => {
			expect(normalizeInscriptions([person('A B', bad, bad)])[0]).toMatchObject({
				born: null,
				died: null
			});
		}
	);

	it('keeps non-English letters', () => {
		expect(normalizeInscriptions([person('Ødegård Sæther')])[0].name).toBe('Ødegård Sæther');
	});

	it.each([
		['TROY LEONARD JUNTUNEN', 'Troy Leonard Juntunen'],
		['CORWIN "CORY" GARNER CHAMBERS', 'Corwin “Cory” Garner Chambers'],
		["MARY O'BRIEN-SMITH", "Mary O'Brien-Smith"],
		['JOHN HILDEBRAND III', 'John Hildebrand III'],
		['VI ANDERSON', 'Vi Anderson'],
		['JAMES ANDERSON VI', 'James Anderson VI'],
		['MARY MCDONALD', 'Mary McDonald'],
		['ANNE "ANNIE SMITH', 'Anne “Annie Smith'],
		['ØDEGÅRD SÆTHER', 'Ødegård Sæther']
	])('title-cases the all-caps carving %s for display', (carved, name) => {
		const [p] = normalizeInscriptions([person(carved)]);
		expect(p.name).toBe(name);
		expect(p.carvedName).toBe(carved);
	});

	it('title-cases an all-caps maiden name', () => {
		expect(normalizeInscriptions([person('GAYNOR HAWKS NÉE STAPLES')])[0]).toMatchObject({
			name: 'Gaynor Hawks',
			maidenName: 'Staples'
		});
	});

	it('curls a straight-quoted nickname so it reads open and close', () => {
		expect(normalizeInscriptions([person('Robert "Bob" Lee')])[0].name).toBe('Robert “Bob” Lee');
	});

	it('leaves a name that was carved in mixed case alone', () => {
		expect(normalizeInscriptions([person('Angus McDonald')])[0].name).toBe('Angus McDonald');
	});

	it('returns an empty list for no people', () => {
		expect(normalizeInscriptions([])).toEqual([]);
	});

	it('keeps a known voice guess in any case and drops anything else', () => {
		const voices = normalizeInscriptions([
			person('Ann Lee', null, null, 'female'),
			person('Tom Lee', null, null, 'male'),
			person('Sam Lee', null, null, 'Female'),
			person('Kit Lee', null, null, 'robot'),
			person('Jo Lee', null, null, null)
		]).map((p) => p.voice);
		expect(voices).toEqual(['female', 'male', 'female', null, null]);
	});
});
