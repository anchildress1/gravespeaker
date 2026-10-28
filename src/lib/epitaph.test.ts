import { describe, expect, it } from 'vitest';
import { epitaph } from './epitaph';
import type { Inscription } from './types';

/**
 * Test helper.
 * @param over Test input.
 * @returns The fixture.
 */
const stone = (over: Partial<Inscription> = {}): Inscription => ({
	carvedName: 'Gaynor Claire Hawks',
	name: 'Gaynor Claire Hawks',
	maidenName: null,
	born: '1932-03-10',
	died: '2017-12-27',
	...over
});
const today = new Date('2026-10-31');

describe('epitaph', () => {
	it('tells name, birth, death and years for full dates', () => {
		expect(epitaph(stone(), today).join(' ')).toBe(
			"My name was Gaynor Claire Hawks. I was born on March 10, 1932. I died on December 27, 2017. I've been here 8 years."
		);
	});

	it('uses "in YYYY" for a year-only birth', () => {
		expect(epitaph(stone({ born: '1932' }), today)).toContain('I was born in 1932.');
	});

	it('omits the death and years sentences when a died digit is unreadable', () => {
		const lines = epitaph(stone({ died: '18?8' }), today);
		expect(lines.some((l) => l.startsWith('I died') || l.startsWith("I've been"))).toBe(false);
	});

	it('omits the birth sentence when born is unknown', () => {
		expect(epitaph(stone({ born: null }), today).some((l) => l.includes('born'))).toBe(false);
	});

	it('says "less than a year" for a recent death', () => {
		expect(epitaph(stone({ died: '2026-06-01' }), today)).toContain(
			"I've been here less than a year."
		);
	});

	it('says "1 year" at exactly one year', () => {
		expect(epitaph(stone({ died: '2025-10-31' }), today)).toContain("I've been here 1 year.");
	});

	it('counts a year-only death by calendar year', () => {
		expect(epitaph(stone({ died: '2011' }), today)).toContain("I've been here 15 years.");
	});
});
