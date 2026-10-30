// Research benchmark: runs the real research workflow for every reviewed fixture person and saves
// the candidates as a new benchmarks/results/research-N.json. SerpApi replays the raw responses in
// fixtures/serp/, so a run costs nothing. RECORD=1 sends a search with no saved response to SerpApi
// (one credit each) and saves it, along with any Google redirect it follows (free). A failed search or
// a redirect that does not redirect is never saved, so the run lists it as missing and the next
// recording retries it. NO_PLACE=1 runs without the fixtures' towns; FIXTURES=people runs only
// people.json.
// Run with `pnpm eval benchmarks/research.eval.ts`.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { normalizeInscriptions } from '../src/lib/server/inscription.ts';
import { runResearch } from '../src/lib/server/research.ts';
import { hopFile, newestRun, RESULTS, SAVED } from './runs.ts';

interface Fixture {
	file: string;
	reviewed: boolean;
	place: string | null;
	people: { name: string; born: string | null; died: string | null }[];
}

const { env } = vi.hoisted(() => {
	process.loadEnvFile('.env');
	return { env: { SERPAPI_API_KEY: process.env.SERPAPI_API_KEY } };
});
vi.mock('$app/env/private', () => env);

const RECORD = process.env.RECORD === '1';
const WITH_PLACE = process.env.NO_PLACE !== '1';
const live = globalThis.fetch;
// Searches each person's run made; searches with no saved response; saved responses that are failures.
let ran: string[] = [];
const missing = new Set<string>();
const failures = new Set<string>();
let recorded = 0;

/**
 * Removes the API key from a SerpApi response before it is saved.
 * @param value Parsed response, or part of one.
 * @returns The value without any `api_key` field.
 */
function scrub(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(scrub);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([k]) => k !== 'api_key')
			.map(([k, v]) => [k, scrub(v)])
	);
}

/**
 * Answers a Google redirect hop from its saved location, recording it when RECORD=1.
 * @param url Redirect URL.
 * @param init Request options.
 * @returns The saved or live redirect.
 */
async function hop(url: URL, init?: RequestInit): Promise<Response> {
	const file = hopFile(url.href);
	if (!existsSync(file) && !RECORD) {
		missing.add(`goto: ${url.href}`);
		return new Response(null, { status: 599 });
	}
	if (!existsSync(file)) {
		const res = await live(url, init);
		const location = res.headers.get('location');
		// Google answers some hops with a page instead of a redirect under load; retry them next time.
		if (!location) {
			missing.add(`goto: ${url.href}`);
			return res;
		}
		const saved = { url: url.href, status: res.status, location };
		writeFileSync(file, `${JSON.stringify(saved, null, '\t')}\n`);
		recorded++;
	}
	const { status, location } = JSON.parse(readFileSync(file, 'utf8'));
	return new Response(null, { status, headers: location ? { location } : {} });
}

/**
 * Answers SerpApi requests from saved responses, recording new ones when RECORD=1.
 * @param input Request URL.
 * @param init Request options.
 * @returns The saved or live response.
 */
async function replay(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.host === 'www.google.com') return hop(url, init);
	if (url.host !== 'serpapi.com') return live(input, init);
	url.searchParams.delete('api_key');
	url.searchParams.sort();
	const engine = url.searchParams.get('engine');
	const query = url.searchParams.get('q') ?? url.searchParams.get('text');
	ran.push(`${engine}: ${query}`);
	const id = createHash('sha256').update(url.search).digest('hex').slice(0, 16);
	const file = `${SAVED}/${engine}-${id}.json`;
	if (existsSync(file)) {
		const saved = JSON.parse(readFileSync(file, 'utf8'));
		if (saved.status >= 400) failures.add(`${engine}: ${query}`);
		return Response.json(saved.body, { status: saved.status });
	}
	if (!RECORD) {
		missing.add(`${engine}: ${query}`);
		return Response.json({ error: 'not recorded' }, { status: 599 });
	}
	let status: number;
	let body: unknown;
	try {
		const res = await live(input, init);
		status = res.status;
		// Only what the provider reads is kept: the rest carries pagination tokens a secret scan flags.
		const { organic_results, error } = (await res.json()) as Record<string, unknown>;
		body = scrub({ organic_results, error });
	} catch (e) {
		missing.add(`${engine}: ${query}`);
		return Response.json({ error: `Not answered: ${(e as Error).name}` }, { status: 504 });
	}
	if (status >= 400) {
		missing.add(`${engine}: ${query}`);
		return Response.json(body, { status });
	}
	const text = JSON.stringify({ engine, query, status, body }, null, '\t');
	// A saved response must never carry the key, whatever SerpApi echoes back.
	if (env.SERPAPI_API_KEY && text.includes(env.SERPAPI_API_KEY)) throw new Error('key in response');
	mkdirSync(SAVED, { recursive: true });
	writeFileSync(file, `${text}\n`);
	recorded++;
	return Response.json(body, { status });
}
vi.stubGlobal('fetch', replay);

/**
 * Reads a fixture file.
 * @param path File relative to the repo root.
 * @returns Its fixtures.
 */
const load = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Fixture[];
// Photo fixtures count once reviewed; people.json cases carry no photo and are labeled per row.
const fixtures = [
	...(process.env.FIXTURES === 'people'
		? []
		: load('fixtures/manifest.json').filter((f) => f.reviewed)),
	...load('fixtures/people.json')
];
/**
 * Names a labeled place the way the app's geocoder does: town and state, the county only when no town
 * is known.
 * @param place Label such as "Eugene, Lane County, Oregon".
 * @returns The place as research receives it, such as "Eugene, Oregon".
 */
function asGeocoded(place: string | null): string | null {
	const parts = place?.split(', ') ?? [];
	return parts.length === 3 ? `${parts[0]}, ${parts[2]}` : (place ?? null);
}

const rows: Record<string, unknown>[] = [];

describe('research', () => {
	it.each(fixtures.flatMap((f) => f.people.map((p) => [`${f.file} ${p.name}`, f, p] as const)))(
		'%s',
		async (_, fixture, person) => {
			ran = [];
			// Normalized as the app does. The voice stays empty so the story eval checks the voice the
			// records give, not the label.
			const [inscription] = normalizeInscriptions([
				{ ...person, voice: null, place: WITH_PLACE ? asGeocoded(fixture.place) : null }
			]);
			const row = {
				file: fixture.file,
				reviewed: fixture.reviewed,
				person,
				inscription,
				searches: ran
			};
			try {
				const candidates = await runResearch(inscription);
				rows.push({ ...row, candidates });
				expect(candidates).toBeInstanceOf(Array);
			} catch (e) {
				// Kept in the run, so tools reading it refuse it instead of quietly losing the person.
				rows.push({ ...row, candidates: [], error: (e as Error).message });
				throw e;
			}
		},
		// Up to 12 searches, each with retries and redirect hops, run one after another while recording.
		600_000
	);
});

afterAll(() => {
	const out = `${RESULTS}/research-${newestRun('research') + 1}.json`;
	const meta = {
		startedAt: new Date().toISOString(),
		withPlace: WITH_PLACE,
		recorded,
		missing: [...missing],
		// Saved failures replay as engine misses; listed so a degraded run is visible.
		failures: [...failures],
		failed: rows.filter((r) => 'error' in r).length
	};
	writeFileSync(out, `${JSON.stringify({ meta, rows }, null, '\t')}\n`);
	console.log(
		`${out}: ${rows.length} people, ${recorded} recorded, ${missing.size} missing, ${failures.size} saved failures, ${meta.failed} failed`
	);
	expect([...missing]).toEqual([]);
});
