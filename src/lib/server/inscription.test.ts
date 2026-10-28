import { describe, expect, it } from 'vitest';
import { normalizeInscriptions } from './inscription';

/**
 * Test helper.
 * @param name Test input.
 * @param born Test input.
 * @param died Test input.
 * @returns The fixture.
 */
const person = (name: string, born: string | null = null, died: string | null = null) => ({
	name,
	born,
	died
});

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

	it('returns an empty list for no people', () => {
		expect(normalizeInscriptions([])).toEqual([]);
	});
});
