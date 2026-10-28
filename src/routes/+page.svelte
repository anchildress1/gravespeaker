<script lang="ts">
	import { epitaph } from '#lib/epitaph.ts';
	import type { ApiError, Candidate, Inscription, Story } from '#lib/types.ts';

	type Phase =
		'capture' | 'reading' | 'pick' | 'researching' | 'confirm' | 'telling' | 'story' | 'epitaph';

	const MAX_BYTES = 10 * 1024 * 1024;
	const TOO_LARGE = 'That photo is over 10 MB. Try a smaller one.';
	const CONFIDENCE = {
		high: 'High confidence match',
		medium: 'Medium confidence match',
		low: 'Unverified: only the name matches. Check the sources before confirming.'
	} as const;
	const NOTES = {
		none: 'No public record was confirmed',
		empty: 'No public records were found',
		insufficient: 'The records hold nothing beyond the stone'
	} as const;

	let phase = $state<Phase>('capture');
	let people = $state<Inscription[]>([]);
	let person = $state<Inscription | null>(null);
	let candidates = $state<Candidate[]>([]);
	let confirmed = $state<Candidate | null>(null);
	let story = $state<Extract<Story, { status: 'told' }> | null>(null);
	let epitaphNote = $state<string>(NOTES.none);
	let message = $state('');
	let retry = $state<(() => void) | null>(null);

	/**
	 * Formats a stored date for display.
	 * @param date Partial date or null.
	 * @returns The date, or "unknown".
	 */
	function show(date: string | null): string {
		return date ?? 'unknown';
	}

	/**
	 * Returns to the capture screen, clearing the journey.
	 * @param note Optional message to show.
	 */
	function reset(note = ''): void {
		phase = 'capture';
		people = [];
		person = null;
		candidates = [];
		confirmed = null;
		story = null;
		message = note;
		retry = null;
	}

	/**
	 * Shows an error with a retry that re-runs the same request.
	 * @param text Message for the visitor.
	 * @param back Phase to return to.
	 * @param again Action the retry button runs.
	 */
	function fail(text: string, back: Phase, again: () => void): void {
		message = text;
		phase = back;
		retry = again;
	}

	/**
	 * Posts to an API endpoint and unwraps errors into messages.
	 * @param url Endpoint path.
	 * @param init Fetch options.
	 * @returns The parsed body.
	 * @throws {Error} With a visitor-safe message.
	 */
	async function call<T>(url: string, init: RequestInit): Promise<T> {
		let res: Response;
		try {
			res = await fetch(url, init);
		} catch {
			throw new Error('Could not reach the server. Check your connection.');
		}
		const body = await res.json().catch(() => null);
		if (!res.ok) {
			if (res.status === 413) throw new Error(TOO_LARGE);
			throw new Error((body as ApiError | null)?.error.message ?? 'Something went wrong.');
		}
		return body as T;
	}

	/**
	 * Uploads the chosen photo and reads the stone.
	 * @param event Change event from the file input.
	 */
	async function onPhoto(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		reset(file.size > MAX_BYTES ? TOO_LARGE : '');
		if (file.size > MAX_BYTES) return;
		await read(file);
	}

	/**
	 * Sends the photo to the read endpoint.
	 * @param file Photo to read.
	 */
	async function read(file: File): Promise<void> {
		phase = 'reading';
		message = '';
		retry = null;
		const form = new FormData();
		form.set('image', file);
		try {
			const res = await call<{ people: Inscription[] }>('/api/read', {
				method: 'POST',
				body: form
			});
			if (res.people.length === 0) reset('No legible name found. Try another photo.');
			else if (res.people.length > 1) {
				people = res.people;
				phase = 'pick';
			} else await research(res.people[0]);
		} catch (e) {
			fail((e as Error).message, 'capture', () => read(file));
		}
	}

	/**
	 * Looks up candidate people for one inscription.
	 * @param p Inscription to research.
	 */
	async function research(p: Inscription): Promise<void> {
		person = p;
		phase = 'researching';
		message = '';
		retry = null;
		try {
			const res = await call<{ candidates: Candidate[] }>('/api/research', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(p)
			});
			candidates = res.candidates;
			if (candidates.length === 0) showEpitaph(NOTES.empty);
			else phase = 'confirm';
		} catch (e) {
			fail((e as Error).message, 'researching', () => research(p));
		}
	}

	/**
	 * Tells the story of the candidate the visitor confirmed.
	 * @param c Confirmed candidate.
	 */
	async function tell(c: Candidate): Promise<void> {
		if (!person) return;
		const p = person;
		confirmed = c;
		phase = 'telling';
		message = '';
		retry = null;
		try {
			const res = await call<Story>('/api/story', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ inscription: p, candidate: c })
			});
			if (res.status === 'told') {
				story = res;
				phase = 'story';
			} else showEpitaph(NOTES.insufficient);
		} catch (e) {
			fail((e as Error).message, 'confirm', () => tell(c));
		}
	}

	/**
	 * Switches to the stone-only epitaph.
	 * @param note Why no story is shown.
	 */
	function showEpitaph(note: string): void {
		epitaphNote = note;
		message = '';
		retry = null;
		phase = 'epitaph';
	}
</script>

<main>
	<h1>Gravespeaker</h1>
	<p class="tag">Every stone has a story. Let it speak.</p>

	{#if message}
		<div class="error" role="alert">
			<p>{message}</p>
			{#if retry}<button type="button" onclick={() => retry?.()}>Try again</button>{/if}
		</div>
	{/if}

	{#if person && phase !== 'capture' && phase !== 'pick'}
		<dl class="stone" aria-label="Read from the stone">
			<dt>Name</dt>
			<dd>{person.name}</dd>
			<dt>Born</dt>
			<dd>{show(person.born)}</dd>
			<dt>Died</dt>
			<dd>{show(person.died)}</dd>
		</dl>
	{/if}

	{#if phase === 'capture'}
		<label class="primary">
			Photograph a headstone
			<input
				type="file"
				accept="image/*"
				capture="environment"
				onchange={onPhoto}
				class="visually-hidden"
			/>
		</label>
	{:else if phase === 'reading'}
		<p role="status">Reading the stone…</p>
	{:else if phase === 'pick'}
		<h2>Whose story?</h2>
		<ul class="list">
			{#each people as p (p.carvedName + p.born + p.died)}
				<li>
					<button type="button" onclick={() => research(p)}>
						<strong>{p.name}</strong>
						<span>{show(p.born)} – {show(p.died)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if phase === 'researching'}
		<p role="status">Searching public records…</p>
	{:else if phase === 'confirm'}
		<h2>Is this them?</h2>
		<ul class="list">
			{#each candidates as c (c.sources[0].id)}
				<li>
					<strong>{c.name}</strong>
					<span>{show(c.born)} – {show(c.died)}</span>
					<span class="confidence" data-confidence={c.confidence}>{CONFIDENCE[c.confidence]}</span>
					<ul class="links">
						{#each c.sources as s (s.id)}
							<li>
								<a href={s.url} target="_blank" rel="external noopener noreferrer"
									>{s.title || s.site}</a
								>
								<small>{s.site}</small>
							</li>
						{/each}
					</ul>
					<button type="button" onclick={() => tell(c)}>This is them</button>
				</li>
			{/each}
		</ul>
		<button type="button" class="quiet" onclick={() => showEpitaph(NOTES.none)}>
			None of these
		</button>
	{:else if phase === 'telling'}
		<p role="status">Listening for {confirmed?.name}…</p>
	{:else if phase === 'story' && story}
		<p class="label">Story generated with AI</p>
		<p class="paragraph">{story.paragraph}</p>
		<h2>Sources</h2>
		<ul class="links">
			{#each story.sources as s (s.id)}
				<li>
					<a href={s.url} target="_blank" rel="external noopener noreferrer">{s.title || s.site}</a>
				</li>
			{/each}
		</ul>
		<button type="button" onclick={() => reset()}>Try another photo</button>
	{:else if phase === 'epitaph' && person}
		<div class="story">
			{#each epitaph(person, new Date()) as line (line)}
				<p class="fact">{line}</p>
			{/each}
		</div>
		<p class="note">{epitaphNote}. Source: the headstone.</p>
		<button type="button" onclick={() => reset()}>Try another photo</button>
	{/if}
</main>

<style>
	main {
		max-width: 36rem;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
		font-family: system-ui, sans-serif;
		line-height: 1.5;
	}
	h1 {
		margin: 0;
	}
	.tag {
		margin: 0 0 1.5rem;
		color: #555;
	}
	button,
	.primary {
		position: relative;
		display: inline-block;
		min-height: 2.75rem;
		padding: 0.5rem 1rem;
		border: 2px solid #222;
		border-radius: 0.5rem;
		background: #222;
		color: #fff;
		font: inherit;
		cursor: pointer;
	}
	.quiet,
	.list button {
		background: transparent;
		color: inherit;
	}
	/* Visually hidden but still focusable, so keyboard users can reach the upload. */
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	button:focus-visible,
	.primary:focus-within,
	a:focus-visible {
		outline: 3px solid #0a5cd6;
		outline-offset: 2px;
	}
	.stone {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
		margin: 0 0 1.5rem;
		padding: 1rem;
		border: 1px solid #ccc;
		border-radius: 0.5rem;
	}
	.stone dt {
		color: #555;
	}
	.stone dd {
		margin: 0;
		font-weight: 600;
	}
	.list,
	.links {
		padding: 0;
		list-style: none;
	}
	.list > li {
		display: grid;
		gap: 0.25rem;
		margin-bottom: 1rem;
		padding: 1rem;
		border: 1px solid #ccc;
		border-radius: 0.5rem;
	}
	.list button {
		display: grid;
		width: 100%;
		text-align: left;
	}
	.links a {
		overflow-wrap: anywhere;
	}
	.confidence {
		font-weight: 600;
	}
	.error {
		margin-bottom: 1rem;
		padding: 1rem;
		border: 2px solid #b00020;
		border-radius: 0.5rem;
	}
	.error p {
		margin: 0 0 0.5rem;
	}
	.label {
		display: inline-block;
		margin: 0 0 1rem;
		padding: 0.25rem 0.75rem;
		border: 2px solid #222;
		border-radius: 999px;
		font-weight: 600;
	}
	.paragraph {
		font-size: 1.125rem;
		line-height: 1.7;
	}
	.story p {
		margin: 0 0 0.75rem;
		padding-left: 0.75rem;
	}
	.fact {
		border-left: 4px solid #222;
	}
	.note {
		color: #555;
	}
	@media (prefers-color-scheme: dark) {
		:global(body) {
			background: #111;
			color: #eee;
		}
		.tag,
		.note,
		.stone dt {
			color: #aaa;
		}
		button,
		.primary {
			border-color: #eee;
			background: #eee;
			color: #111;
		}
		.quiet,
		.list button {
			background: transparent;
			color: inherit;
		}
		.stone,
		.list > li {
			border-color: #444;
		}
		.fact {
			border-left-color: #eee;
		}
		.label {
			border-color: #eee;
		}
		a {
			color: #8ab4ff;
		}
	}
</style>
