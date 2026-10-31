import { describe, expect, it } from 'vitest';
import { pageEvidence, resolveMatches } from './identity';
import type { Inscription, SourceRecord } from '#lib/types.ts';

/**
 * Test helper.
 * @param over Test input.
 * @returns The fixture.
 */
const stone = (over: Partial<Inscription> = {}): Inscription => ({
	carvedName: 'Gaynor Claire Hawks',
	name: 'Gaynor Claire Hawks',
	maidenName: null,
	place: null,
	born: '1932-03-10',
	died: '2017-12-27',
	voice: 'female',
	...over
});
/**
 * Builds a search result.
 * @param snippet Result snippet text.
 * @param title Result title.
 * @param id Result id.
 * @returns The record.
 */
const rec = (snippet: string, title = 'Obituary', id = 'x'): SourceRecord => ({
	id,
	url: `https://legacy.com/${id}`,
	title,
	site: 'legacy.com',
	snippet
});

describe('resolveMatches', () => {
	/**
	 * Resolves records against the default stone.
	 * @param records Search results.
	 * @param over Stone fields to override.
	 * @returns The candidates.
	 */
	const resolve = (records: SourceRecord[], over: Partial<Inscription> = {}) =>
		resolveMatches(stone(over), records);

	it('returns nothing when no result names the person', () => {
		expect(resolve([rec('Cemetery index of the county, 1932 to 2017.')])).toEqual([]);
		expect(resolve([])).toEqual([]);
	});

	it('returns the right person when only the birth is stated and the death is missing', () => {
		const [c] = resolve([rec('Gaynor Hawks, born March 10, 1932, taught piano in Alsea.')]);
		expect(c.sources).toHaveLength(1);
		expect(c.confidence).toBe('medium');
		expect(c.born).toBe('1932');
		expect(c.died).toBeNull();
	});

	it('returns the right person when only the death is stated', () => {
		const [c] = resolve([rec('Gaynor Claire Hawks died December 27, 2017 at home.')]);
		expect(c.confidence).toBe('medium');
		expect(c.died).toBe('2017');
	});

	it.each([
		'Gaynor Claire Hawks (1932-2017) - Find a Grave memorial',
		'Gaynor Hawks, Mar 10, 1932 - Dec 27, 2017, obituary',
		'Charles Hawks (1930–2010). His wife Gaynor Hawks (1932–2017).'
	])('rates a name plus both matching years high: %s', (snippet) => {
		const [c] = resolve([rec(snippet)]);
		expect(c.confidence).toBe('high');
		expect([c.born, c.died]).toEqual(['1932', '2017']);
	});

	it.each([
		'Gaynor Hawks, Jun 8, 1940 - Jul 18, 2012, obituary',
		'Gaynor Hawks June 8, 1940 – July 18, 2012',
		'Gaynor Hawks 8 Jun 1940 - 18 Jul 2012',
		'Gaynor Hawks 06/08/1940 - 07/18/2012'
	])('excludes a namesake whose full-date range contradicts the stone: %s', (snippet) => {
		expect(resolve([rec(snippet)])).toEqual([]);
	});

	it('keeps a record neutral when the birth place is named but not the birth year', () => {
		const [c] = resolve([rec('Gaynor Hawks, born in London, died in 2017.')]);
		expect(c.confidence).toBe('medium');
		expect(c.died).toBe('2017');
	});

	it('matches a maiden name written in parentheses between the given and family name', () => {
		const [c] = resolve([rec('Gaynor (Staples) Hawks (1932–2017)')], { maidenName: 'Staples' });
		expect(c.confidence).toBe('high');
	});

	it("does not read another person's dates as the matched name's", () => {
		const [c] = resolve([rec('Gaynor Hawks, born 1932. She married John Smith (1930–2010).')]);
		expect(c.confidence).toBe('medium');
		expect(c.born).toBe('1932');
	});

	it('does not accept a different given name for a stone that carries only an initial', () => {
		const initial = { name: 'J. Smith', carvedName: 'J. Smith' };
		expect(resolve([rec('Mary Smith (1932–2017), a schoolteacher.')], initial)).toEqual([]);
		expect(resolve([rec('John Smith (1932–2017), a schoolteacher.')], initial)).toHaveLength(1);
		expect(resolve([rec('J. Smith (1932–2017), a schoolteacher.')], initial)).toHaveLength(1);
	});

	it('matches a surname-first name that follows descriptive words', () => {
		const [c] = resolve([rec('Obituary for Hawks, Gaynor (1932–2017).')]);
		expect(c.confidence).toBe('high');
	});

	it("does not read another person's labelled year from a later sentence", () => {
		const [c] = resolve([rec('Gaynor Hawks, born 1932. Her husband John Smith died 2010.')]);
		expect(c.confidence).toBe('medium');
		expect([c.born, c.died]).toEqual(['1932', null]);
	});

	it('keeps reading the same person when the next sentence only states a life event', () => {
		expect(resolve([rec('Gaynor Hawks, born 1932. Died in 2010.')])).toEqual([]);
		const [c] = resolve([rec('Gaynor Hawks, born 1932. Died in 2017.')]);
		expect(c.confidence).toBe('high');
	});

	it('derives the birth year from a stated age', () => {
		const [c] = resolve([rec('Gaynor Hawks, age 85, died December 27, 2017.')]);
		expect(c.confidence).toBe('high');
	});

	it('keeps a name-only result at low confidence instead of discarding it', () => {
		const [c] = resolve([rec('Gaynor Hawks was a beloved piano teacher in Alsea.')]);
		expect(c.confidence).toBe('low');
		expect(c.sources).toHaveLength(1);
		expect([c.born, c.died]).toEqual([null, null]);
	});

	it('drops name-only results once a stronger result exists', () => {
		const out = resolve([
			rec('Gaynor Hawks was a beloved piano teacher.', 'A', 'a'),
			rec('Gaynor Hawks, born 1932, of Alsea.', 'B', 'b')
		]);
		expect(out[0].sources.map((s) => s.id)).toEqual(['b']);
	});

	it('excludes a result whose stated death year conflicts', () => {
		expect(resolve([rec('Gaynor Hawks (1932-2016) obituary')])).toEqual([]);
		expect(resolve([rec('Gaynor Hawks, born 1950, died 2017')])).toEqual([]);
	});

	it('excludes a namesake with different dates but keeps the real match', () => {
		const out = resolve([
			rec('Gaynor Hawks (1901-1970) memorial', 'Other', 'o'),
			rec('Gaynor Hawks (1932-2017) memorial', 'Real', 'r')
		]);
		expect(out[0].sources.map((s) => s.id)).toEqual(['r']);
	});

	it('does not match a different given name with the same surname', () => {
		expect(resolve([rec('Charles Hawks (1932-2017) obituary')])).toEqual([]);
	});

	it('matches the surname as a whole word, not inside a longer name', () => {
		expect(resolve([rec('Gaynor Hawksworth (1932-2017)')])).toEqual([]);
	});

	it('accepts a middle name or initial in place of the full given names', () => {
		expect(resolve([rec('Claire Hawks (1932-2017)')])).toHaveLength(1);
		expect(resolve([rec('Gaynor C. Hawks (1932-2017)')])).toHaveLength(1);
	});

	it('uses the maiden name when the stone carries one', () => {
		const record = rec('Gaynor Staples (1932-2017), later Hawks');
		expect(resolve([record], { maidenName: 'Staples' })).toHaveLength(1);
	});

	it('ignores generational suffixes on the stone', () => {
		const junior = { name: 'Edward Hildebrand III', carvedName: 'Edward Hildebrand III' };
		expect(resolve([rec('Edward Hildebrand (1932-2017)')], junior)).toHaveLength(1);
	});

	it('reads a stone that stacks two suffixes', () => {
		const stacked = { name: 'Edward Hildebrand Jr. II', carvedName: 'Edward Hildebrand Jr. II' };
		expect(resolve([rec('Edward Hildebrand (1932-2017)')], stacked)).toHaveLength(1);
	});

	it('keeps a surname that is an object property name', () => {
		const ada = { name: 'Ada Constructor', carvedName: 'Ada Constructor' };
		expect(resolve([rec('Ada Constructor (1932-2017)')], ada)).toHaveLength(1);
	});

	it('folds accents when comparing names', () => {
		const norse = { name: 'Ødegård Sæther', carvedName: 'Ødegård Sæther' };
		expect(resolve([rec('Odegard Saether (1932-2017)')], norse)).toHaveLength(1);
	});

	it('treats ? in a stone year as a wildcard', () => {
		const worn = { name: 'Betsey Ellis', carvedName: 'Betsey Ellis', born: '18?8', died: null };
		const [c] = resolve([rec('Betsey Ellis (1818-1850) memorial')], worn);
		expect(c.confidence).toBe('high');
		expect(resolve([rec('Betsey Ellis (1749-1800)')], worn)).toEqual([]);
	});

	it('never conflicts on a date the stone does not carry', () => {
		const bornOnly = { born: '1932-03-10', died: null };
		expect(resolve([rec('Gaynor Hawks, born 1932, died 1999')], bornOnly)).toHaveLength(1);
	});

	it('rates name-only low when the stone carries no dates', () => {
		const bare = { born: null, died: null };
		expect(resolve([rec('Gaynor Hawks, piano teacher')], bare)[0].confidence).toBe('low');
	});

	it('ignores years that sit far from the name, where another person is likely meant', () => {
		const far = rec(
			`Gaynor Hawks, born 1932, taught piano. ${'Local history notes. '.repeat(30)} Howard Hawks (1896-1977).`
		);
		expect(resolve([far])[0].confidence).toBe('medium');
	});

	it.each([
		['a later sentence', 'Passing of Alfonso Gonzalez on June 7. He was born on May 16, 1986.'],
		[
			'a title before the surname',
			'Alfonso Gonzalez Obituary. Mr. Gonzalez was born on April 22, 1954.'
		]
	])('drops a name-only result that gives a year against the stone in %s', (_, snippet) => {
		const alfonso = {
			name: 'Alfonso Gonzalez',
			carvedName: 'Alfonso Gonzalez',
			born: '1951-11-18',
			died: '2021-01-17'
		};
		expect(resolve([rec(snippet)], alfonso)).toEqual([]);
	});

	it.each([
		[
			'an abbreviated month',
			'Charles LeRoy Hildebrand, 81, of Winnebago, died Tuesday, Dec. 25, 2012.'
		],
		[
			'a saint town',
			'Edward Eugene Hildebrand, Jr., 59, of St. Matthews passed away on Sunday, October 15, 2023.'
		],
		['a dashed day-month-year range', 'Edward Leroy Hildebrand 05-Sep-1929 - 01-Sep-2024.']
	])('reads a conflicting death year written with %s', (_, snippet) => {
		const edward = {
			name: 'Edward Leroy Hildebrand Jr',
			carvedName: 'Edward Leroy Hildebrand Jr',
			born: '1942-04-28',
			died: '2015-10-10'
		};
		expect(resolve([rec(snippet)], edward)).toEqual([]);
	});

	it.each([
		['an ordinal day', 'Reynolds, Stephen Passed away on September 21st, 2022 in Windsor.'],
		['an abbreviated weekday', 'Stephen Reynolds, 88, passed away Wed. June 19, 2013.']
	])('reads a conflicting death year after %s', (_, snippet) => {
		const stephen = {
			name: 'Stephen Abraham Reynolds Jr.',
			carvedName: 'Stephen Abraham Reynolds Jr.',
			born: '1989-02-20',
			died: '2014-02-08'
		};
		expect(resolve([rec(snippet)], stephen)).toEqual([]);
	});

	it('rejects a middle initial the stone rules out', () => {
		const daisy = {
			name: 'Daisy M. Morgan',
			carvedName: 'Daisy M. Morgan',
			born: null,
			died: null
		};
		expect(
			resolve([rec('Daisy Morgan Obituary. Daisy A. Morgan, 83, loving wife.')], daisy)
		).toEqual([]);
		expect(resolve([rec('Daisy M. Morgan obituary')], daisy)).toHaveLength(1);
	});

	it('keeps a record that adds a middle initial the stone leaves out', () => {
		const daisy = { name: 'Daisy Morgan', carvedName: 'Daisy Morgan' };
		const [c] = resolve([rec('Daisy M. Morgan (1932-2017), a schoolteacher.')], daisy);
		expect(c.confidence).toBe('high');
	});

	it("keeps a record about the stone's person that also names a relative with another initial", () => {
		const daisy = { name: 'Daisy M. Morgan', carvedName: 'Daisy M. Morgan' };
		const snippet = 'Daisy M. Morgan (1932-2017) is survived by granddaughter Daisy A. Morgan.';
		expect(resolve([rec(snippet)], daisy)[0].confidence).toBe('high');
	});

	it("drops a relative's mention and reads no dates from it", () => {
		const daisy = { name: 'Daisy A. Morgan', carvedName: 'Daisy A. Morgan' };
		const snippet = 'Daisy M. Morgan (1910-1990) is survived by granddaughter Daisy A. Morgan.';
		expect(resolve([rec(snippet)], daisy)).toEqual([]);
	});

	it.each([
		['Jr. against Sr.', 'Stephen Reynolds Sr. (1989-2014) of Lamar.', 0],
		['Jr. against III', 'Stephen A. Reynolds III (1989-2014) of Lamar.', 0],
		['Jr. as II', 'Stephen A. Reynolds II (1989-2014) of Lamar.', 1],
		['Jr. as Junior', 'Stephen Reynolds, Junior (1989-2014) of Lamar.', 1],
		[
			'Jr. beside his father Sr.',
			'Stephen Reynolds Jr. (1989-2014), son of Stephen Reynolds Sr.',
			1
		],
		['a bare name beside a Sr.', 'Stephen Reynolds (1989-2014), son of Stephen Reynolds Sr.', 0]
	])('compares generational suffixes: %s', (_, snippet, found) => {
		const stephen = {
			name: 'Stephen Abraham Reynolds Jr.',
			carvedName: 'Stephen Abraham Reynolds Jr.',
			born: '1989-02-20',
			died: '2014-02-08'
		};
		expect(resolve([rec(snippet)], stephen)).toHaveLength(found);
	});

	it('checks no suffix the stone does not carry', () => {
		expect(resolve([rec('Gaynor Claire Hawks Sr. (1932-2017)')])).toHaveLength(1);
	});

	it('reads "I" after a surname as a suffix only before punctuation', () => {
		const junior = { name: 'Edward Hildebrand Jr.', carvedName: 'Edward Hildebrand Jr.' };
		expect(resolve([rec('Edward Hildebrand I, 1932-2017.')], junior)).toEqual([]);
		expect(resolve([rec('Edward Hildebrand I remember, 1932-2017.')], junior)).toHaveLength(1);
	});

	it('reads the age after a suffix set off by commas', () => {
		// Age 59 at a 2023 death puts the birth in 1963 or 1964, against the stone's 1950.
		const edward = {
			name: 'Edward Hildebrand Jr.',
			carvedName: 'Edward Hildebrand Jr.',
			born: '1950-01-01',
			died: null
		};
		const snippet = 'Edward Hildebrand, Jr., 59, of St. Matthews passed away on October 15, 2023.';
		expect(resolve([rec(snippet)], edward)).toEqual([]);
	});

	it("does not read another person's comma-set age as the person's age", () => {
		const [c] = resolve([rec('Gaynor Hawks died in 2017 and leaves son John, 12, of Eugene.')]);
		expect(c.confidence).toBe('medium');
	});

	it('reads "wed." as a weekday, which can only drop a match, never add one', () => {
		expect(resolve([rec('Gaynor Hawks and John Hawks wed. Mary Smith died 1990.')])).toEqual([]);
	});

	it('does not read "married" as a month that carries a range over to the name', () => {
		const [c] = resolve([rec('Gaynor Hawks died in 2017. Married 1950 – 2001 to John Hawks.')]);
		expect(c.confidence).toBe('medium');
	});

	it('does not match on an initial alone when the stone spells out a given name', () => {
		const georgia = {
			name: 'Georgia D. Hiatt',
			carvedName: 'Georgia D. Hiatt',
			born: null,
			died: null
		};
		expect(resolve([rec("Thai DelRay Hiatt's obituary")], georgia)).toEqual([]);
	});

	it("drops a page titled with another person's dates that lists the stone's person as kin", () => {
		const russell = {
			name: 'Russell O Bell',
			carvedName: 'Russell O Bell',
			born: '1924-09-24',
			died: '1994-02-08'
		};
		const kin = rec(
			'Tonie Silas Bell. Lucian Clyde Bell. 1919–2000. PFC Russell O Bell. 1924–1994.',
			'Tonie Silas Bell (1892-1960) - Find a Grave Memorial'
		);
		expect(resolve([kin], russell)).toEqual([]);
	});

	it('reads the life range in the sentence after the name', () => {
		const louella = {
			name: 'Louella Marie White',
			carvedName: 'Louella Marie White',
			born: '1935-08-22',
			died: '2017-05-24'
		};
		const [c] = resolve(
			[rec('Louella Marie White. 22 Aug 1935 – 24 May 2017. This memorial is managed.')],
			louella
		);
		expect(c.confidence).toBe('high');
	});

	it('derives the birth year from an age set off by commas', () => {
		const troy = {
			name: 'Troy Leonard Juntunen',
			carvedName: 'Troy Leonard Juntunen',
			born: '1967-01-28',
			died: '2012-08-03'
		};
		const [c] = resolve(
			[rec('Troy Leonard Juntunen, 45, of Richland, Wash., died Aug. 3, 2012.')],
			troy
		);
		expect(c.confidence).toBe('high');
	});

	it('keeps at most five sources, best first', () => {
		const many = Array.from({ length: 7 }, (_, i) =>
			rec(i === 6 ? 'Gaynor Hawks (1932-2017)' : 'Gaynor Hawks, piano teacher', 'R', `s${i}`)
		);
		const [c] = resolve(many);
		expect(c.sources).toHaveLength(1);
		const weak = Array.from({ length: 7 }, (_, i) =>
			rec('Gaynor Hawks, piano teacher', 'R', `w${i}`)
		);
		expect(resolve(weak)[0].sources).toHaveLength(5);
	});

	it('keeps a name-only page about the life, not only records of a death', () => {
		const out = resolve([rec('Gaynor Hawks plays tennis.', 'Profile', 'tennis')]);
		expect(out.flatMap((c) => c.sources.map((s) => s.id))).toEqual(['tennis']);
	});

	it('keeps two people with different dates as separate candidates instead of merging them', () => {
		const worn = { name: 'John Smith', carvedName: 'John Smith', born: '19?8', died: null };
		const out = resolve(
			[
				rec('John Smith (1938-2011) obituary', 'A', 'a'),
				rec('John Smith (1948-2015) obituary', 'B', 'b')
			],
			worn
		);
		expect(out).toHaveLength(2);
		const ids = out.map((c) => c.sources.map((s) => s.id));
		expect(ids.flat().sort()).toEqual(['a', 'b']);
		expect(ids.every((i) => i.length === 1)).toBe(true);
	});

	it('ranks the person more results agree on first when two people tie', () => {
		const worn = { name: 'John Smith', carvedName: 'John Smith', born: '19?8', died: null };
		const out = resolve(
			[
				rec('John Smith (1938-2011) obituary', 'A', 'a'),
				rec('John Smith (1948-2015) obituary', 'B', 'b1'),
				rec('John Smith, born 1948, retired teacher', 'B', 'b2')
			],
			worn
		);
		expect(out.map((c) => c.sources.map((s) => s.id))).toEqual([['b1', 'b2'], ['a']]);
	});

	it('keeps search rank between two people with equal support', () => {
		const worn = { name: 'John Smith', carvedName: 'John Smith', born: '19?8', died: null };
		const out = resolve(
			[
				rec('John Smith (1938-2011) obituary', 'A', 'a'),
				rec('John Smith (1948-2015) obituary', 'B', 'b')
			],
			worn
		);
		expect(out.map((c) => c.sources[0].id)).toEqual(['a', 'b']);
	});

	it('merges results that agree with each other into one candidate', () => {
		const out = resolve([
			rec('Gaynor Hawks (1932-2017) memorial', 'A', 'a'),
			rec('Gaynor Hawks, born 1932, died December 2017', 'B', 'b')
		]);
		expect(out).toHaveLength(1);
		expect(out[0].sources).toHaveLength(2);
	});

	it('splits name-only results that state conflicting years for a stone with no dates', () => {
		const bare = { born: null, died: null };
		const out = resolve(
			[rec('Gaynor Hawks, died 1980', 'A', 'a'), rec('Gaynor Hawks, died 2005', 'B', 'b')],
			bare
		);
		expect(out).toHaveLength(2);
	});

	it('returns at most three candidates', () => {
		const worn = { name: 'John Smith', carvedName: 'John Smith', born: '19??', died: null };
		const many = ['1931', '1942', '1953', '1964', '1975'].map((y, i) =>
			rec(`John Smith (${y}-2020)`, 'R', `s${i}`)
		);
		expect(resolve(many, worn)).toHaveLength(3);
	});

	it('accepts a quoted nickname as a given name', () => {
		const nick = {
			name: 'Corwin "Cory" Garner Chambers',
			carvedName: 'Corwin "Cory" Garner Chambers'
		};
		expect(resolve([rec('Cory Chambers (1932-2017) obituary')], nick)).toHaveLength(1);
	});

	it('does not combine a given name and a surname taken from different people', () => {
		expect(resolve([rec('Charles Hawks (1932-2017). Survived by Gaynor Jones.')])).toEqual([]);
		expect(resolve([rec('Charles Hawks, Gaynor Jones (1932-2017)')])).toEqual([]);
	});

	it('accepts "Surname, Given" ordering and a nickname or middle name between the parts', () => {
		expect(resolve([rec('Hawks, Gaynor C. (1932-2017)')])).toHaveLength(1);
		expect(resolve([rec('Gaynor "Gay" Marie Hawks (1932-2017)')])).toHaveLength(1);
	});

	it.each([
		['a middle initial the stone rules out', 'Hawks, Gaynor B. (1932-2017)', {}, 0],
		["the stone's own initial before the given name", 'Hawks, C. Gaynor (1932-2017)', {}, 1],
		[
			'a conflicting suffix',
			'Reynolds, Stephen Sr. (1989-2014)',
			{ name: 'Stephen Reynolds Jr.', carvedName: 'Stephen Reynolds Jr.' },
			0
		],
		[
			"the stone's own suffix",
			'Reynolds, Stephen A., Jr. (1989-2014)',
			{ name: 'Stephen Abraham Reynolds Jr.', carvedName: 'Stephen Abraham Reynolds Jr.' },
			1
		],
		['a list that names another initial later', 'Hawks, Gaynor, and A. Smith (1932-2017)', {}, 1]
	])('reads "Surname, Given" with %s', (_, snippet, stone, found) => {
		const dates = 'name' in stone ? { born: '1989-02-20', died: '2014-02-08' } : {};
		expect(resolve([rec(snippet)], { ...stone, ...dates })).toHaveLength(found);
	});

	it('accepts "Surname, Given" when the stone gives only an initial', () => {
		expect(
			resolve([rec('Hawks, G. (1932-2017)')], { name: 'G. Hawks', carvedName: 'G. Hawks' })
		).toHaveLength(1);
	});

	it('keeps the years each source states when the stone carries no dates', () => {
		const bare = { born: null, died: null };
		const out = resolve(
			[rec('Gaynor Hawks (1932-2017)', 'A', 'a'), rec('Gaynor Hawks (1942-2020)', 'B', 'b')],
			bare
		);
		expect(out.map((c) => [c.born, c.died]).sort()).toEqual([
			['1932', '2017'],
			['1942', '2020']
		]);
	});

	it('does not report a birth year derived from an age that the stone cannot confirm', () => {
		const bare = { born: null, died: null };
		const [c] = resolve([rec('Gaynor Hawks, age 85, died December 27, 2017.')], bare);
		expect([c.born, c.died]).toEqual([null, '2017']);
	});

	it('excludes a result whose day-first or numeric birth date conflicts', () => {
		expect(resolve([rec('Gaynor Hawks, born 10 March 1940, died 2017.')])).toEqual([]);
		expect(resolve([rec('Gaynor Hawks, born 03/10/1940, died 2017.')])).toEqual([]);
		expect(resolve([rec('Gaynor Hawks, born 10-03-1940, died 2017.')])).toEqual([]);
	});

	it('reads day-first dates that agree with the stone', () => {
		const [c] = resolve([rec('Gaynor Hawks, born 10 March 1932, died 27 December 2017.')]);
		expect([c.confidence, c.born, c.died]).toEqual(['high', '1932', '2017']);
	});

	it('excludes a stone born later than the age and death year allow', () => {
		const later = { born: '1933-01-01' };
		expect(resolve([rec('Gaynor Hawks, age 85, died December 27, 2017.')], later)).toEqual([]);
	});

	it('accepts either birth year an age allows', () => {
		const earlier = { born: '1931-06-01' };
		const [c] = resolve([rec('Gaynor Hawks, age 85, died December 27, 2017.')], earlier);
		expect([c.confidence, c.born]).toEqual(['high', '1931']);
	});

	it('separates an age-derived birth from a stated birth year outside its interval', () => {
		const bare = { born: null, died: null };
		const split = resolve(
			[rec('Gaynor Hawks, age 85, died 2017', 'A', 'a'), rec('Gaynor Hawks (1933-2017)', 'B', 'b')],
			bare
		);
		expect(split).toHaveLength(2);
		const merged = resolve(
			[rec('Gaynor Hawks, age 85, died 2017', 'A', 'a'), rec('Gaynor Hawks (1931-2017)', 'B', 'b')],
			bare
		);
		expect(merged).toHaveLength(1);
	});
});

describe('pageEvidence', () => {
	it.each([
		['the life range', 'Gaynor Claire Hawks (1932-2017) taught piano.', 'high'],
		[
			'the death year alone',
			'Services for Gaynor Hawks, who died in 2017, were held Friday.',
			'medium'
		],
		[
			'the dates far down a long page',
			`${'Menu Home Obituaries. '.repeat(200)}Gaynor Hawks, 1932 - 2017.`,
			'high'
		],
		['no years', 'Gaynor Hawks taught piano for forty years.', 'low'],
		[
			'the years under another name',
			'Mary Smith (1932-2017). Gaynor Hawks sang in the choir.',
			'low'
		]
	])('grades a page stating %s', (_, text, grade) => {
		expect(pageEvidence(stone(), text)).toEqual({ grade, conflicts: false });
	});

	it.each([
		["a namesake's years", 'Gaynor Hawks (1918-1979) taught piano.', true],
		['the years without the name', 'In memory, 1932 - 2017.', false]
	])('rejects a page stating %s', (_, text, conflicts) => {
		expect(pageEvidence(stone(), text)).toEqual({ grade: null, conflicts });
	});
});
