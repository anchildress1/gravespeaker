// Usage: node benchmarks/run.ts <prompt.json> <out.json> <model...>
// Hosted model names go to the Gemini API; `ollama:<name>` runs locally.
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeInscriptions } from '../src/lib/server/inscription.ts';

interface Prompt {
	system?: string;
	user: string;
	sampling: { temperature: number; topP?: number; topK?: number };
	schema?: object;
	// Gemini API only; Ollama ignores it.
	mediaResolution?: string;
}

interface Row {
	file: string;
	model: string;
	ms: number;
	got?: unknown;
	// The app's deterministic layer applied to `got.people` (run 10 onward).
	normalized?: unknown;
	error?: string;
	raw?: string;
}

const [promptPath, outFile, ...models] = process.argv.slice(2);
const fixturesDir = new URL('../fixtures/', import.meta.url);
const P: Prompt = JSON.parse(await readFile(promptPath, 'utf8'));

/**
 * Calls a hosted model on the Gemini API.
 * @param model Gemini API model name.
 * @param img Base64 JPEG.
 * @returns The reply text with thought parts removed.
 * @throws {Error} On a non-2xx response or timeout.
 */
async function hosted(model: string, img: string): Promise<string> {
	const res = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
		{
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-goog-api-key': process.env.GEMINI_API_KEY ?? ''
			},
			body: JSON.stringify({
				...(P.system && { systemInstruction: { parts: [{ text: P.system }] } }),
				contents: [
					{
						role: 'user',
						parts: [{ inline_data: { mime_type: 'image/jpeg', data: img } }, { text: P.user }]
					}
				],
				generationConfig: {
					...P.sampling,
					...(P.mediaResolution && { mediaResolution: P.mediaResolution }),
					...(P.schema && { responseMimeType: 'application/json', responseJsonSchema: P.schema })
				}
			}),
			signal: AbortSignal.timeout(240_000)
		}
	);
	const body = await res.json();
	if (!res.ok) throw new Error(`${res.status} ${body.error?.message ?? ''}`.slice(0, 200));
	const parts: { text?: string; thought?: boolean }[] = body.candidates?.[0]?.content?.parts ?? [];
	return parts
		.filter((p) => !p.thought)
		.map((p) => p.text ?? '')
		.join('');
}

/**
 * Calls a local model through Ollama with thinking off.
 * @param model Ollama model tag.
 * @param img Base64 JPEG.
 * @returns The reply text.
 * @throws {Error} On a non-2xx response or timeout.
 */
async function ollama(model: string, img: string): Promise<string> {
	const { temperature, topP, topK } = P.sampling;
	// nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request -- Ollama listens on loopback only.
	const res = await fetch('http://127.0.0.1:11434/api/chat', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			model,
			stream: false,
			think: false,
			format: P.schema,
			options: { temperature, top_p: topP, top_k: topK },
			messages: [
				...(P.system ? [{ role: 'system', content: P.system }] : []),
				{ role: 'user', content: P.user, images: [img] }
			]
		}),
		signal: AbortSignal.timeout(240_000)
	});
	const body = await res.json();
	if (!res.ok) throw new Error(`${res.status} ${body.error ?? ''}`);
	return body.message.content;
}

/**
 * Parses a reply. Schema replies must be pure JSON; prose-format replies are cut to the outermost braces.
 * @param raw Reply text.
 * @returns The parsed object.
 * @throws {SyntaxError} When the reply is not valid JSON.
 */
function parse(raw: string): unknown {
	return JSON.parse(P.schema ? raw : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
}

const manifest: { file: string }[] = JSON.parse(
	await readFile(new URL('manifest.json', fixturesDir), 'utf8')
);
const results: Row[] = [];
for (const { file } of manifest) {
	const img = (await readFile(new URL(file, fixturesDir))).toString('base64');
	for (const model of models) {
		const t0 = performance.now();
		const row: Row = { file, model, ms: 0 };
		let raw = '';
		try {
			raw = model.startsWith('ollama:')
				? await ollama(model.slice(7), img)
				: await hosted(model, img);
			row.got = parse(raw);
			const people = (row.got as { people?: Parameters<typeof normalizeInscriptions>[0] }).people;
			if (Array.isArray(people)) row.normalized = normalizeInscriptions(people);
		} catch (e) {
			const err = e as Error;
			row.error = err.name === 'SyntaxError' ? 'unparseable JSON' : `${err.name}: ${err.message}`;
			if (raw) row.raw = raw;
		}
		row.ms = Math.round(performance.now() - t0);
		results.push(row);
		await writeFile(outFile, JSON.stringify(results, null, 2));
		console.error(`${file.padEnd(24)} ${model.padEnd(22)} ${row.error ?? 'ok'} ${row.ms}ms`);
	}
}
