<script lang="ts">
	import AppHeader from '#lib/components/AppHeader.svelte';
	import Invitation from '#lib/components/Invitation.svelte';
	import Searching, { type SearchPhase } from '#lib/components/Searching.svelte';
	import Stepper from '#lib/components/Stepper.svelte';
	import StoryView from '#lib/components/StoryView.svelte';
	import { locate } from '#lib/locate.ts';
	import type { ApiError, Candidate, Inscription, Story } from '#lib/types.ts';

	type Phase = 'capture' | SearchPhase | 'story';

	// One status line that outlives every screen, so a screen reader hears each step and the story arriving.
	const ANNOUNCE: Record<Phase, string> = {
		capture: '',
		reading: 'Reading the stone…',
		pick: 'More than one person is named. Choose whose story to tell.',
		researching: 'Searching historical records…',
		telling: 'Building the story…',
		story: 'Story ready.'
	};

	const MAX_BYTES = 10 * 1024 * 1024;
	const TOO_LARGE = 'That photo is over 10 MB. Try a smaller one.';
	const NOTES = {
		empty: 'No public records were found',
		insufficient: 'The records hold nothing beyond the stone'
	} as const;

	let phase = $state<Phase>('capture');
	let people = $state<Inscription[]>([]);
	let person = $state<Inscription | null>(null);
	let match = $state<Candidate | null>(null);
	let story = $state<Story | null>(null);
	let epitaphNote = $state('');
	let message = $state('');
	let retry = $state<(() => void) | null>(null);
	let photoUrl = $state<string | null>(null);
	// Starting over aborts this, so a late reply cannot pull the visitor back into the old journey.
	let journey = new AbortController();

	/**
	 * Returns to the capture screen, clearing the journey.
	 * @param note Optional message to show.
	 */
	function reset(note = ''): void {
		journey.abort();
		journey = new AbortController();
		phase = 'capture';
		people = [];
		person = null;
		match = null;
		story = null;
		message = note;
		retry = null;
		if (photoUrl) URL.revokeObjectURL(photoUrl);
		photoUrl = null;
	}

	/**
	 * Shows an error with a retry that re-runs the same request; a request dropped by starting over shows nothing.
	 * @param e Error the request threw.
	 * @param back Phase to return to.
	 * @param again Action the retry button runs.
	 */
	function fail(e: unknown, back: Phase, again: () => void): void {
		if (e instanceof DOMException && e.name === 'AbortError') return;
		message = (e as Error).message;
		phase = back;
		retry = again;
	}

	/**
	 * Posts to an API endpoint and unwraps errors into messages.
	 * @param url Endpoint path.
	 * @param init Fetch options.
	 * @returns The parsed body.
	 * @throws {Error} With a visitor-safe message, or an `AbortError` when the visitor started over.
	 */
	async function call<T>(url: string, init: RequestInit): Promise<T> {
		const { signal } = journey;
		let res: Response;
		try {
			res = await fetch(url, { ...init, signal });
		} catch (e) {
			if (signal.aborted) throw e;
			throw new Error('Could not reach the server. Check your connection.', { cause: e });
		}
		const body = await res.json().catch(() => null);
		signal.throwIfAborted();
		if (!res.ok) {
			if (res.status === 413) throw new Error(TOO_LARGE);
			throw new Error((body as ApiError | null)?.error.message ?? 'Something went wrong.');
		}
		return body as T;
	}

	/**
	 * Uploads the chosen or captured photo and reads the stone.
	 * @param file Photo to read.
	 */
	async function onPhoto(file: File): Promise<void> {
		reset(file.size > MAX_BYTES ? TOO_LARGE : '');
		if (file.size > MAX_BYTES) return;
		photoUrl = URL.createObjectURL(file);
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
		const { signal } = journey;
		try {
			const at = await locate();
			// Starting over during the location prompt must not upload the abandoned photo.
			signal.throwIfAborted();
			if (at) {
				form.set('lat', String(at.lat));
				form.set('lon', String(at.lon));
			}
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
			fail(e, 'capture', () => read(file));
		}
	}

	/**
	 * Looks up the person behind one inscription and tells their story.
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
			// Research ranks the best match first; the story step falls back to the stone when that
			// match's pages don't hold up.
			const [best] = res.candidates;
			await (best ? tell(best) : tell(null, NOTES.empty));
		} catch (e) {
			fail(e, 'researching', () => research(p));
		}
	}

	/**
	 * Tells the story of the best match, or of the stone alone when there is none.
	 * @param c Best match, or null for the stone alone.
	 * @param note Why the story rests on the stone, shown if the server falls back to it.
	 */
	async function tell(c: Candidate | null, note: string = NOTES.insufficient): Promise<void> {
		if (!person) return;
		const p = person;
		match = c;
		phase = 'telling';
		message = '';
		retry = null;
		try {
			story = await call<Story>('/api/story', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(c ? { inscription: p, candidate: c } : { inscription: p })
			});
			epitaphNote = note;
			phase = 'story';
		} catch (e) {
			fail(e, 'telling', () => tell(c, note));
		}
	}
</script>

<p class="visually-hidden" role="status">{ANNOUNCE[phase]}</p>

{#if phase === 'capture'}
	<main class="full">
		<Invitation {message} {retry} onphoto={onPhoto} />
	</main>
{:else}
	<main>
		<AppHeader onback={() => reset()} />
		{#if phase === 'story'}
			<Stepper current={2} />
			{#if person && story}
				<StoryView {person} {match} {story} {photoUrl} {epitaphNote} onreset={() => reset()} />
			{/if}
		{:else}
			<Stepper current={1} />
			<Searching {phase} {photoUrl} {person} {people} {message} {retry} onpick={research} />
		{/if}
	</main>
{/if}

<style>
	main {
		max-width: 30rem;
		margin: 0 auto;
		padding: 0 1rem 2.5rem;
	}
	.full {
		padding: 0;
	}
</style>
