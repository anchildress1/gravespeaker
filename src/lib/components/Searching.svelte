<script lang="ts" module>
	export type SearchPhase = 'reading' | 'pick' | 'researching' | 'confirm' | 'telling';
</script>

<script lang="ts">
	import { lifespan, shownDate } from '#lib/lifespan.ts';
	import type { Candidate, Inscription } from '#lib/types.ts';
	import ErrorNotice from './ErrorNotice.svelte';
	import Moon from './Moon.svelte';

	const STEPS = [
		'Reading the stone',
		'Searching historical records',
		'Confirming the match',
		'Building the story'
	];
	// Index of the first unfinished step per phase; pick waits on the visitor before research.
	const CURRENT: Record<SearchPhase, number> = {
		reading: 0,
		pick: 1,
		researching: 1,
		confirm: 2,
		telling: 3
	};
	const CONFIDENCE = {
		high: 'High confidence match',
		medium: 'Medium confidence match',
		low: 'Unverified: only the name matches. Check the sources before confirming.'
	} as const;

	let {
		phase,
		photoUrl,
		person,
		people,
		candidates,
		message,
		retry,
		onpick,
		onconfirm,
		onnone
	}: {
		phase: SearchPhase;
		photoUrl: string | null;
		person: Inscription | null;
		people: Inscription[];
		candidates: Candidate[];
		message: string;
		retry: (() => void) | null;
		onpick: (p: Inscription) => void;
		onconfirm: (c: Candidate) => void;
		onnone: () => void;
	} = $props();

	const busy = $derived(
		!message && (phase === 'reading' || phase === 'researching' || phase === 'telling')
	);
	const current = $derived(CURRENT[phase]);

	/**
	 * Names a checklist step's state for screen readers and styling.
	 * @param i Step index.
	 * @returns "done", "in progress", "waiting for you" or "pending".
	 */
	function stateOf(i: number): string {
		if (i < current) return 'done';
		if (i > current) return 'pending';
		return busy ? 'in progress' : 'waiting for you';
	}
</script>

<div class="photo" class:scanning={busy}>
	{#if photoUrl}<img src={photoUrl} alt="The headstone you uploaded" />{/if}
</div>

{#if person && phase !== 'pick'}
	<dl class="stone" aria-label="Read from the stone">
		<dt class="eyebrow">Name</dt>
		<dd>{person.name}</dd>
		<dt class="eyebrow">Born</dt>
		<dd>{shownDate(person.born)}</dd>
		<dt class="eyebrow">Died</dt>
		<dd>{shownDate(person.died)}</dd>
	</dl>
{/if}

<ol class="checklist">
	{#each STEPS as label, i (label)}
		{@const state = stateOf(i)}
		<li data-state={state}>
			<span class="icon" aria-hidden="true">
				{#if state === 'done'}
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
						><path d="M3 8.5 6.5 12 13 4.5" stroke-width="1.6" /></svg
					>
				{/if}
			</span>
			<span class="label">{label}</span>
			<span class="visually-hidden">— {state}</span>
			{#if state === 'in progress'}<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span
				>{/if}
		</li>
	{/each}
</ol>

{#if message}<ErrorNotice {message} {retry} />{/if}

{#if phase === 'pick'}
	<h2>Whose story?</h2>
	<ul class="cards">
		{#each people as p (p.carvedName + p.born + p.died)}
			<li>
				<button type="button" class="pick" onclick={() => onpick(p)}>
					<strong>{p.name}</strong>
					<span>{lifespan(p)}</span>
				</button>
			</li>
		{/each}
	</ul>
{:else if phase === 'confirm'}
	<h2>Is this them?</h2>
	<p class="hint">Pick one, or none. Nothing is merged without you.</p>
	<ul class="cards">
		{#each candidates as c (c.sources[0].id)}
			<li class="card">
				<strong>{c.name}</strong>
				<span class="dates">{lifespan(c)}</span>
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
				<button type="button" class="button quiet" onclick={() => onconfirm(c)}>This is them</button
				>
			</li>
		{/each}
	</ul>
	<button type="button" class="link-button none" onclick={onnone}>None of these</button>
{/if}

<footer>
	<p>“Names open doors. Records fill the rooms.”</p>
	<span class="divider" aria-hidden="true"><Moon size={18} /></span>
</footer>

<style>
	.photo {
		position: relative;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--verdigris) 60%, transparent);
		border-radius: 0.75rem;
		background: var(--slate);
		box-shadow: 0 0 24px color-mix(in srgb, var(--verdigris) 18%, transparent);
	}
	.photo img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	/* A soft band of light sweeps the photo only while a request is actually in flight. */
	.scanning::after {
		position: absolute;
		inset: -30% 0 auto;
		height: 30%;
		background: linear-gradient(
			transparent,
			color-mix(in srgb, var(--verdigris) 35%, transparent) 50%,
			transparent
		);
		mix-blend-mode: screen;
		content: '';
	}
	@keyframes scan {
		to {
			transform: translateY(430%);
		}
	}
	.stone {
		display: grid;
		grid-template-columns: max-content 1fr;
		align-items: baseline;
		gap: 0.125rem 1rem;
		margin: 1rem 0 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--slate);
	}
	.stone .eyebrow {
		font-size: 0.8125rem;
	}
	.stone dd {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 1.0625rem;
	}
	.checklist {
		display: grid;
		gap: 0.25rem;
		margin: 1rem 0;
		padding: 0.5rem 1rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--slate);
		list-style: none;
	}
	.checklist li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 2.25rem;
		color: var(--mist);
		font-size: 0.9375rem;
		transition: color 0.4s ease;
	}
	.icon {
		display: grid;
		flex: none;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border: 1px dashed var(--line);
		border-radius: 50%;
		color: var(--verdigris);
		transition:
			border-color 0.4s ease,
			background-color 0.4s ease;
	}
	.checklist [data-state='done'],
	.checklist [data-state='in progress'],
	.checklist [data-state='waiting for you'] {
		color: var(--bone);
	}
	[data-state='done'] .icon {
		border: 1px solid var(--verdigris);
	}
	[data-state='in progress'] .icon,
	[data-state='waiting for you'] .icon {
		border: 1px solid var(--bone);
	}
	.label {
		flex: 1;
	}
	.dots {
		display: flex;
		gap: 0.25rem;
	}
	.dots i {
		width: 0.3rem;
		height: 0.3rem;
		border-radius: 50%;
		background: var(--bone);
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
		}
	}
	h2 {
		margin: 1.5rem 0 0.25rem;
		font-family: var(--font-serif);
		font-size: 1.625rem;
		font-weight: 400;
	}
	.hint {
		margin: 0 0 1rem;
		color: var(--mist);
		font-size: 0.9375rem;
	}
	.cards,
	.links {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.cards {
		display: grid;
		gap: 1rem;
	}
	.card,
	.pick {
		display: grid;
		gap: 0.375rem;
		width: 100%;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--slate);
		color: inherit;
		text-align: left;
	}
	.pick {
		cursor: pointer;
	}
	.card strong,
	.pick strong {
		font-family: var(--font-serif);
		font-size: 1.25rem;
		font-weight: 400;
	}
	.dates,
	.pick span {
		color: var(--mist);
		font-family: var(--font-serif);
	}
	.confidence {
		color: var(--verdigris);
		font-size: 0.9375rem;
	}
	.confidence[data-confidence='low'] {
		color: var(--lantern);
	}
	.links li {
		margin: 0.25rem 0;
		overflow-wrap: anywhere;
	}
	.links small {
		margin-left: 0.5rem;
		color: var(--mist);
	}
	.card .button {
		margin-top: 0.5rem;
	}
	.none {
		display: block;
		margin: 1rem auto 0;
	}
	footer {
		display: grid;
		justify-items: center;
		gap: 0.75rem;
		margin-top: 2rem;
		color: var(--mist);
	}
	footer p {
		margin: 0;
		font-family: var(--font-serif);
		font-style: italic;
	}
	.divider {
		display: flex;
		align-items: center;
		gap: 1rem;
		width: 100%;
	}
	.divider::before,
	.divider::after {
		flex: 1;
		height: 1px;
		background: var(--line);
		content: '';
	}
	/* Motion runs only on mouse-driven screens: phones are too slow for it. */
	@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
		.scanning::after {
			animation: scan 2.8s ease-in-out infinite;
		}
		.dots i {
			animation: pulse 1.2s ease-in-out infinite;
		}
		.dots i:nth-child(2) {
			animation-delay: 0.2s;
		}
		.dots i:nth-child(3) {
			animation-delay: 0.4s;
		}
	}
</style>
