import { describe, expect, it } from 'vitest';
import type { Inscription } from '../../src/lib/types.ts';
import { ageAtDeath, yearsOutsideLife } from './stone-years';

/**
 * Builds a stone's person.
 * @param born Birth date as carved.
 * @param died Death date as carved.
 * @returns The inscription.
 */
const stone = (born: string | null, died: string | null): Inscription => ({
	carvedName: 'LLOYD DEE DIXON',
	name: 'Lloyd Dee Dixon',
	maidenName: null,
	born,
	died,
	voice: 'male',
	place: null
});

describe('yearsOutsideLife', () => {
	it('flags a namesake birth and death that contradict the stone', () => {
		const story = 'I was born on December 20, 1914. I passed on December 1, 2021.';
		expect(yearsOutsideLife(story, stone('1943-07-11', '2018-05-26'))).toEqual([1914, 2021]);
	});

	it('accepts years from birth to death inclusive', () => {
		const story = 'Born in 1943, I worked from 1965 until I died in 2018.';
		expect(yearsOutsideLife(story, stone('1943-07-11', '2018-05-26'))).toEqual([]);
	});

	it('bounds only the side the stone records', () => {
		expect(yearsOutsideLife('I married in 1740 and died in 1752.', stone(null, '1752'))).toEqual(
			[]
		);
		expect(yearsOutsideLife('Still here in 2021.', stone(null, '1752'))).toEqual([2021]);
	});

	it('ignores a date with an illegible digit', () => {
		expect(yearsOutsideLife('Born in 1914.', stone('19?3', '2018'))).toEqual([]);
	});

	it('ignores a four-digit number past the current year', () => {
		const today = new Date('2026-10-29');
		expect(yearsOutsideLife('I lived at 2455 Union Blvd.', stone('1929', '2019'), today)).toEqual(
			[]
		);
		expect(yearsOutsideLife('Gone since 2026.', stone('1929', '2019'), today)).toEqual([2026]);
	});

	it('ignores numbers that are not four-digit years', () => {
		expect(
			yearsOutsideLife('I lived at 12825 16th Ave for 21 years.', stone('1943', '2018'))
		).toEqual([]);
	});
});

describe('ageAtDeath', () => {
	it('gives the exact age when both full dates are carved', () => {
		expect(ageAtDeath(stone('1921-06-30', '2017-11-19'))).toBe('I died at 96 years old.');
	});

	it('counts a birthday not yet reached in the year of death', () => {
		expect(ageAtDeath(stone('1921-12-30', '2017-11-19'))).toBe('I died at 95 years old.');
	});

	it('hedges when only years are carved', () => {
		expect(ageAtDeath(stone('1938', '2004'))).toBe('I died at about 66 years old.');
	});

	it('says nothing when a year is missing or illegible', () => {
		expect(ageAtDeath(stone(null, '1839-02-17'))).toBeNull();
		expect(ageAtDeath(stone('19?3', '2018'))).toBeNull();
	});
});
