// Usage: node benchmarks/pipeline.ts <base-url> <out.json>
// Drives the running app end to end for every fixture photo: read, research, story.
// Needs the app running with real keys (`pnpm build && pnpm preview --port 5400`).
import { readFile, writeFile } from 'node:fs/promises';

interface Person {
	name: string | null;
	born: string | null;
	died: string | null;
}

interface Fixture {
	file: string;
	people: Person[];
}

interface Row {
	file: string;
	read?: { ms: number; got: Person[]; correct: number; total: number };
	research?: {
		ms: number;
		confidence: string | null;
		sources: number;
		born: string | null;
		died: string | null;
	};
	story?: { ms: number; status: string; words: number; sources: number };
	error?: string;
	totalMs: number;
}

const [base, outFile] = process.argv.slice(2);
const fixturesDir = new URL('../fixtures/', import.meta.url);
const origin = new URL(base).origin;

/**
 * Lowercases a name and keeps only comparable ASCII tokens.
 * @param name Name as returned or recorded.
 * @returns Comparable tokens without honorifics.
 */
function nameKey(name: string | null | undefined): string {
	return (name ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9 ]+/g, ' ')
		.split(/\s+/)
		.filter((t) => t && !['mr', 'mrs', 'miss', 'dr'].includes(t))
		.join(' ');
}

/**
 * Counts correct name, born and died fields for the people the stone is for.
 * @param expected Ground-truth people.
 * @param got People the app returned.
 * @returns Correct and total field counts. A stone with no legible name expects no people.
 */
function score(expected: Person[], got: Person[]): { correct: number; total: number } {
	if (!expected.length) return { correct: got.length ? 0 : 1, total: 1 };
	const pool = [...got];
	let correct = 0;
	for (const p of expected) {
		const i = pool.findIndex((q) => nameKey(q.name) === nameKey(p.name));
		const q = i >= 0 ? pool.splice(i, 1)[0] : null;
		if (q) correct += 1 + Number((q.born ?? null) === p.born) + Number((q.died ?? null) === p.died);
	}
	return { correct, total: expected.length * 3 };
}

/**
 * Posts to an endpoint and times it.
 * @param path Endpoint path.
 * @param init Fetch options.
 * @returns Elapsed milliseconds and the parsed body.
 * @throws {Error} On a non-2xx response.
 */
async function call<T>(path: string, init: RequestInit): Promise<{ ms: number; body: T }> {
	const t0 = performance.now();
	const res = await fetch(new URL(path, base), {
		...init,
		headers: { origin, ...(init.headers as Record<string, string>) },
		signal: AbortSignal.timeout(300_000)
	});
	const body = (await res.json()) as T;
	if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(body).slice(0, 160)}`);
	return { ms: Math.round(performance.now() - t0), body };
}

/**
 * Median of a list.
 * @param xs Numbers.
 * @returns The median, or 0 for an empty list.
 */
function median(xs: number[]): number {
	if (!xs.length) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const manifest: Fixture[] = JSON.parse(
	await readFile(new URL('manifest.json', fixturesDir), 'utf8')
);
const rows: Row[] = [];
const wall0 = performance.now();

for (const f of manifest) {
	const image = await readFile(new URL(f.file, fixturesDir)).catch(() => null);
	if (!image) {
		console.error(`${f.file.padEnd(24)} skipped: image not found`);
		continue;
	}
	const row: Row = { file: f.file, totalMs: 0 };
	const t0 = performance.now();
	try {
		const form = new FormData();
		form.set('image', new File([image], f.file, { type: 'image/jpeg' }));
		const read = await call<{
			people: (Person & { carvedName: string; maidenName: string | null })[];
		}>('/api/read', { method: 'POST', body: form });
		const s = score(f.people, read.body.people);
		row.read = { ms: read.ms, got: read.body.people, ...s };
		// Research the person the answer key names first, so a two-person stone is judged fairly.
		const target =
			read.body.people.find((p) => nameKey(p.name) === nameKey(f.people[0]?.name)) ??
			read.body.people[0];
		if (target) {
			const research = await call<{
				candidates: {
					born: string | null;
					died: string | null;
					confidence: string;
					sources: unknown[];
				}[];
			}>('/api/research', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(target)
			});
			const c = research.body.candidates[0];
			row.research = {
				ms: research.ms,
				confidence: c?.confidence ?? null,
				sources: c?.sources.length ?? 0,
				born: c?.born ?? null,
				died: c?.died ?? null
			};
			if (c) {
				const story = await call<{ status: string; paragraph?: string; sources?: unknown[] }>(
					'/api/story',
					{
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ inscription: target, candidate: c })
					}
				);
				row.story = {
					ms: story.ms,
					status: story.body.status,
					words: story.body.paragraph?.split(/\s+/).length ?? 0,
					sources: story.body.sources?.length ?? 0
				};
			}
		}
	} catch (e) {
		row.error = (e as Error).message;
	}
	row.totalMs = Math.round(performance.now() - t0);
	rows.push(row);
	await writeFile(outFile, JSON.stringify({ rows }, null, 2));
	console.error(
		`${f.file.padEnd(24)} read ${row.read?.ms ?? '-'}ms  research ${row.research?.ms ?? '-'}ms (${row.research?.confidence ?? 'none'})  story ${row.story?.ms ?? '-'}ms (${row.story?.status ?? '-'})  total ${row.totalMs}ms${row.error ? '  ERROR ' + row.error : ''}`
	);
}

const wallMs = Math.round(performance.now() - wall0);
const readRows = rows.filter((r) => r.read);
const found = rows.filter((r) => r.research?.confidence);
const told = rows.filter((r) => r.story?.status === 'told');
const summary = {
	stones: rows.length,
	wallMs,
	errors: rows.filter((r) => r.error).length,
	read: {
		fieldsCorrect: readRows.reduce((a, r) => a + r.read!.correct, 0),
		fieldsTotal: readRows.reduce((a, r) => a + r.read!.total, 0),
		medianMs: median(readRows.map((r) => r.read!.ms))
	},
	research: {
		attempted: rows.filter((r) => r.research).length,
		candidateFound: found.length,
		byConfidence: Object.fromEntries(
			['high', 'medium', 'low'].map((k) => [
				k,
				found.filter((r) => r.research!.confidence === k).length
			])
		),
		medianMs: median(rows.filter((r) => r.research).map((r) => r.research!.ms))
	},
	story: {
		attempted: rows.filter((r) => r.story).length,
		told: told.length,
		insufficient: rows.filter((r) => r.story?.status === 'insufficient').length,
		medianMs: median(rows.filter((r) => r.story).map((r) => r.story!.ms))
	},
	medianTotalMs: median(rows.map((r) => r.totalMs))
};
await writeFile(outFile, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
