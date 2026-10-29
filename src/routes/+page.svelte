<script lang="ts">
	import AppHeader from '#lib/components/AppHeader.svelte';
	import Invitation from '#lib/components/Invitation.svelte';
	import Searching, { type SearchPhase } from '#lib/components/Searching.svelte';
	import Stepper from '#lib/components/Stepper.svelte';
	import StoryView from '#lib/components/StoryView.svelte';
	import type { ApiError, Candidate, Inscription, Story } from '#lib/types.ts';

	type Phase = 'capture' | SearchPhase | 'story';

	const MAX_BYTES = 10 * 1024 * 1024;
	const TOO_LARGE = 'That photo is over 10 MB. Try a smaller one.';
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
	let story = $state<Story | null>(null);
	let epitaphNote = $state<string>(NOTES.none);
	let message = $state('');
	let retry = $state<(() => void) | null>(null);
	let photoUrl = $state<string | null>(null);

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
		if (photoUrl) URL.revokeObjectURL(photoUrl);
		photoUrl = null;
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
			if (candidates.length === 0) await tell(null, NOTES.empty);
			else phase = 'confirm';
		} catch (e) {
			fail((e as Error).message, 'researching', () => research(p));
		}
	}

	/**
	 * Tells the story of the confirmed candidate, or of the stone alone when there is none.
	 * @param c Confirmed candidate, or null for the stone alone.
	 * @param note Why the story rests on the stone, shown if the server falls back to it.
	 */
	async function tell(c: Candidate | null, note: string = NOTES.insufficient): Promise<void> {
		if (!person) return;
		const p = person;
		confirmed = c;
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
			fail((e as Error).message, c ? 'confirm' : 'telling', () => tell(c, note));
		}
	}
</script>

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
				<StoryView {person} {confirmed} {story} {photoUrl} {epitaphNote} onreset={() => reset()} />
			{/if}
		{:else}
			<Stepper current={1} />
			<Searching
				{phase}
				{photoUrl}
				{person}
				{people}
				{candidates}
				{message}
				{retry}
				onpick={research}
				onconfirm={tell}
				onnone={() => tell(null, NOTES.none)}
			/>
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
