// Usage: node benchmarks/score.ts <results.json...>
// Prints a markdown table per fixture and model. Run 10 onward scores `normalized`; earlier runs score `got`. Rows for fixtures no longer in the manifest are skipped.
import { readFile } from 'node:fs/promises';

interface Person {
	name: string | null;
	born: string | null;
	died: string | null;
}

interface Fixture {
	file: string;
	text: string | null;
	people: Person[];
}

interface Row {
	file: string;
	model: string;
	ms: number;
	got?: { text?: string | null; people?: Partial<Person>[] };
	// Present from run 10 on: `got.people` after the app's normalization. Scored in preference to `got`.
	normalized?: Partial<Person>[];
	error?: string;
}

/**
 * Middle value of a list; mean of the two middle values for an even count.
 * @param xs Numbers to summarize.
 * @returns The median.
 */
function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const HONORIFICS = new Set(['mr', 'mrs', 'miss', 'dr']);

/**
 * Lowercases and collapses everything except letters, digits and `?` to single spaces.
 * @param s Text to normalize.
 * @returns Normalized text.
 */
function norm(s: string | null | undefined): string {
	return (s ?? '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}?]+/gu, ' ')
		.trim();
}

/**
 * Levenshtein edit distance.
 * @param a First string.
 * @param b Second string.
 * @returns Number of single-character edits.
 */
function lev(a: string, b: string): number {
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++)
			cur.push(
				Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
			);
		prev = cur;
	}
	return prev[b.length];
}

/**
 * Scores transcription similarity.
 * @param expected Ground-truth inscription; null when illegible.
 * @param got Model transcription.
 * @returns 1 − distance / expected length, floored at 0.
 */
function textScore(expected: string | null, got: string | null | undefined): number {
	const e = norm(expected);
	const g = norm(got);
	if (!e) return g ? 0 : 1;
	return Math.max(0, 1 - lev(e, g) / e.length);
}

/**
 * Turns a name into comparable ASCII tokens without honorifics.
 * @param name Name as returned or recorded.
 * @returns Lowercase tokens.
 */
function nameTokens(name: string | null | undefined): string {
	return (name ?? '')
		.toLowerCase()
		.replace('m.r', 'mr')
		.replace(/[^a-z0-9 ]+/g, ' ')
		.split(/\s+/)
		.filter((t) => t && !HONORIFICS.has(t))
		.join(' ');
}

/**
 * Counts correct name/born/died fields. A wrong name zeroes that person's dates.
 * @param expected Ground-truth people.
 * @param got People the model returned.
 * @returns Correct and total field counts, plus returned people that match no one on the stone.
 */
function peopleScore(
	expected: Person[],
	got: Partial<Person>[]
): { correct: number; total: number; extra: number } {
	if (!expected.length) return { correct: got.length ? 0 : 1, total: 1, extra: got.length };
	const pool = [...got];
	let correct = 0;
	for (const p of expected) {
		const i = pool.findIndex((q) => nameTokens(q.name) === nameTokens(p.name));
		const q = i >= 0 ? pool.splice(i, 1)[0] : null;
		if (!q) continue;
		correct += 1 + Number((q.born ?? null) === p.born) + Number((q.died ?? null) === p.died);
	}
	return { correct, total: expected.length * 3, extra: pool.length };
}

const manifest: Fixture[] = JSON.parse(
	await readFile(new URL('../fixtures/manifest.json', import.meta.url), 'utf8')
);
const byFile = new Map(manifest.map((f) => [f.file, f]));
const rows: Row[] = [];
for (const path of process.argv.slice(2)) rows.push(...JSON.parse(await readFile(path, 'utf8')));

const agg = new Map<
	string,
	{
		calls: number;
		ms: number;
		errors: number;
		text: number;
		textN: number;
		correct: number;
		total: number;
		extra: number;
		times: number[];
	}
>();
const cells = new Map<string, string>();
for (const r of rows) {
	const f = byFile.get(r.file);
	if (!f) continue;
	const a = agg.get(r.model) ?? {
		calls: 0,
		ms: 0,
		errors: 0,
		text: 0,
		textN: 0,
		correct: 0,
		total: 0,
		extra: 0,
		times: []
	};
	agg.set(r.model, a);
	a.calls++;
	a.ms += r.ms;
	a.times.push(r.ms);
	if (r.error || !r.got) {
		a.errors++;
		cells.set(`${r.file}|${r.model}`, r.error?.includes('Timeout') ? 'timeout' : 'bad JSON');
		continue;
	}
	// Prompts without a text field skip transcription scoring.
	if ('text' in r.got) {
		a.text += textScore(f.text, r.got.text);
		a.textN++;
	}
	const read = r.normalized ?? r.got.people;
	const s = peopleScore(f.people, Array.isArray(read) ? read : []);
	a.correct += s.correct;
	a.total += s.total;
	a.extra += s.extra;
	cells.set(
		`${r.file}|${r.model}`,
		`${s.correct}/${s.total}${s.extra ? ` +${s.extra} extra` : ''}`
	);
}

const models = [...agg.keys()];
const stats = [...agg.values()];
/**
 * Prints one markdown table row.
 * @param cols Cell values.
 */
const line = (cols: string[]): void => {
	console.log(`| ${cols.join(' | ')} |`);
};
line(['Fixture', ...models]);
line(['---', ...models.map(() => '---')]);
for (const f of manifest)
	line([f.file.replace(/\.jpg$/, ''), ...models.map((m) => cells.get(`${f.file}|${m}`) ?? '-')]);
line([
	'**Fields correct**',
	...stats.map((a) => `**${a.correct}/${a.total} (${Math.round((100 * a.correct) / a.total)}%)**`)
]);
line([
	'Text similarity',
	...stats.map((a) => (a.textN ? `${((100 * a.text) / a.textN).toFixed(1)}%` : 'n/a'))
]);
line(['Extra people (not on the stone)', ...stats.map((a) => String(a.extra))]);
line(['Errors', ...stats.map((a) => String(a.errors))]);
line(['Median time per photo', ...stats.map((a) => `${(median(a.times) / 1000).toFixed(1)} s`)]);
line(['Avg time per photo', ...stats.map((a) => `${(a.ms / a.calls / 1000).toFixed(1)} s`)]);
