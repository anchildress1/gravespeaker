// Usage: node --env-file=.env benchmarks/query-experiment.ts
// One-off: compares three query shapes on Google for four stones. Output: results/query-experiment-1.txt.
import { readFileSync } from 'node:fs';
import { resolveMatches } from '../src/lib/server/identity.ts';
interface Fixture {
	file: string;
	people: { name: string; born: string; died: string }[];
}
interface Organic {
	link: string;
	title?: string;
	snippet?: string;
}
const manifest: Fixture[] = JSON.parse(
	readFileSync(new URL('../fixtures/manifest.json', import.meta.url), 'utf8')
);
const key = process.env.SERPAPI_API_KEY!;
const pick = ['chambers', 'dixon', 'mills', 'luxford'];
/**
 * Removes a quoted nickname from a name.
 * @param n Name as carved.
 * @returns The name without the nickname.
 */
const clean = (n: string): string =>
	n
		.replace(/"[^"]*"/g, '')
		.replace(/\s+/g, ' ')
		.trim();
for (const f of manifest.filter((m) => pick.includes(m.file.split('-')[0]))) {
	const p = f.people[0];
	const name = clean(p.name);
	const ins = { carvedName: p.name, name, maidenName: null, born: p.born, died: p.died };
	const by = p.born.slice(0, 4),
		dy = p.died.slice(0, 4);
	const forms: Record<string, string> = {
		current: `"${name}" ${by} ${dy} (obituary OR grave OR cemetery)`,
		deathYear: `"${name}" ${dy} obituary`,
		nameOnly: `"${name}" obituary`
	};
	for (const [label, q] of Object.entries(forms)) {
		const url = new URL('https://serpapi.com/search.json');
		url.search = new URLSearchParams({
			engine: 'google',
			q,
			num: '10',
			gl: 'us',
			hl: 'en',
			api_key: key
		}).toString();
		const t0 = performance.now();
		const body: { organic_results?: Organic[]; error?: string } = await (await fetch(url)).json();
		const records = (body.organic_results ?? []).map((r, i: number) => ({
			id: `s${i}`,
			url: r.link,
			title: r.title ?? '',
			site: new URL(r.link).hostname,
			snippet: r.snippet ?? ''
		}));
		const c = resolveMatches(ins, records);
		console.log(
			`${f.file.padEnd(22)} ${label.padEnd(10)} results=${String(records.length).padStart(2)} candidates=${c.length} ${c.map((x) => x.confidence + '/' + x.sources.length).join(',') || '-'} ${body.error ? 'ERR ' + body.error.slice(0, 40) : ''} ${Math.round(performance.now() - t0)}ms`
		);
	}
}
