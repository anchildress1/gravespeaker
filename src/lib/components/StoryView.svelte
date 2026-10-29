<script lang="ts">
	import { epitaph } from '#lib/epitaph.ts';
	import type { Candidate, Inscription, Story } from '#lib/types.ts';
	import NarrationBar from './NarrationBar.svelte';

	let {
		person,
		confirmed,
		story,
		photoUrl,
		epitaphNote,
		onreset
	}: {
		person: Inscription;
		confirmed: Candidate | null;
		story: Story;
		photoUrl: string | null;
		epitaphNote: string;
		onreset: () => void;
	} = $props();

	// A told story names the confirmed record; a stone story only ever has the stone. Dates come
	// from the stone alone: a record's dates may come from a source the story does not cite.
	const subject = $derived(story.status === 'told' && confirmed ? confirmed : person);

	const TABS = [
		{ id: 'story', label: 'Story' },
		{ id: 'facts', label: 'Facts' },
		{ id: 'sources', label: 'Sources' }
	] as const;
	type Tab = (typeof TABS)[number]['id'];
	let tab = $state<Tab>('story');

	/**
	 * Moves between tabs with the arrow, Home and End keys, as the ARIA tabs pattern expects.
	 * @param event Key press on the tab list.
	 */
	function onTabKey(event: KeyboardEvent): void {
		const at = TABS.findIndex((t) => t.id === tab);
		const next = {
			ArrowRight: (at + 1) % TABS.length,
			ArrowLeft: (at - 1 + TABS.length) % TABS.length,
			Home: 0,
			End: TABS.length - 1
		}[event.key];
		if (next === undefined) return;
		event.preventDefault();
		tab = TABS[next].id;
		document.getElementById(`tab-${tab}`)?.focus();
	}
</script>

<div class="story-view" class:narrated={story.paragraph}>
	<section class="header-card" aria-label="Who this is">
		{#if photoUrl}<img src={photoUrl} alt="The headstone you uploaded" />{/if}
		<h2>{subject.name}</h2>
		<p class="lifespan">
			{person.born ?? 'unknown'} to {person.died ?? 'unknown'}
		</p>
	</section>

	{#if story.status === 'told'}
		<div role="tablist" aria-label="Story sections" tabindex="-1" onkeydown={onTabKey}>
			{#each TABS as t (t.id)}
				<button
					type="button"
					role="tab"
					id="tab-{t.id}"
					aria-controls="panel-{t.id}"
					aria-selected={tab === t.id}
					tabindex={tab === t.id ? 0 : -1}
					onclick={() => (tab = t.id)}>{t.label}</button
				>
			{/each}
		</div>

		<div
			id="panel-story"
			role="tabpanel"
			tabindex="0"
			aria-labelledby="tab-story"
			hidden={tab !== 'story'}
			class="reveal"
		>
			<p class="label">Story generated with AI</p>
			<p class="paragraph">{story.paragraph}</p>
			<p class="disclaimer">
				An AI reconstruction written from the linked records. It is not testimony.
			</p>
		</div>

		<div
			id="panel-facts"
			role="tabpanel"
			tabindex="0"
			aria-labelledby="tab-facts"
			hidden={tab !== 'facts'}
			class="reveal"
		>
			<dl class="facts">
				<dt>Born</dt>
				<dd>{person.born ?? 'unknown'}</dd>
				<dt>Died</dt>
				<dd>{person.died ?? 'unknown'}</dd>
			</dl>
			<p class="cite">From the headstone.</p>
		</div>

		<div
			id="panel-sources"
			role="tabpanel"
			tabindex="0"
			aria-labelledby="tab-sources"
			hidden={tab !== 'sources'}
			class="reveal"
		>
			<ul class="links">
				{#each story.sources as s (s.id)}
					<li>
						<a href={s.url} target="_blank" rel="external noopener noreferrer"
							>{s.title || s.site}</a
						>
						<small>{s.site}</small>
					</li>
				{/each}
			</ul>
		</div>
	{:else if story.paragraph}
		<section class="reveal">
			<p class="label">Story generated with AI</p>
			<p class="paragraph">{story.paragraph}</p>
			<p class="disclaimer">
				An AI reconstruction written from the headstone alone. It is not testimony.
			</p>
			<p class="cite">{epitaphNote}. Source: the headstone.</p>
		</section>
	{:else}
		<section class="reveal">
			<h3 class="eyebrow">From the stone</h3>
			<div class="epitaph">
				{#each epitaph(person, new Date()) as line (line)}
					<p>{line}</p>
				{/each}
			</div>
			<p class="cite">{epitaphNote}. Source: the headstone.</p>
		</section>
	{/if}

	<button type="button" class="button quiet again" onclick={onreset}>Try another photo</button>
</div>

{#if story.paragraph}<NarrationBar />{/if}

<style>
	.narrated {
		padding-bottom: 5rem;
	}
	.header-card {
		position: relative;
		overflow: hidden;
		padding: 1.25rem;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		background:
			radial-gradient(ellipse at 100% 0%, rgb(127 168 154 / 0.12), transparent 60%), var(--slate);
	}
	/* The visitor's own photo sits behind the name, fading out before the text. */
	.header-card img {
		position: absolute;
		inset: 0 0 0 35%;
		width: 65%;
		height: 100%;
		object-fit: cover;
		opacity: 0.6;
		filter: saturate(0.45) brightness(0.85);
		mask-image: linear-gradient(to right, transparent, #000 60%);
	}
	h2,
	.lifespan {
		position: relative;
	}
	h2 {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 2rem;
		font-weight: 400;
		line-height: 1.2;
	}
	.lifespan {
		margin: 0.25rem 0 0;
		font-family: var(--font-serif);
		font-size: 1.25rem;
	}
	[role='tablist'] {
		position: sticky;
		z-index: 1;
		top: 0;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin: 1rem 0;
		border-bottom: 1px solid var(--line);
		background: var(--ink);
	}
	[role='tab'] {
		padding: 0.75rem 0;
		border: 0;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--mist);
		font-family: var(--font-display);
		font-size: 0.875rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		cursor: pointer;
	}
	[role='tab'][aria-selected='true'] {
		border-bottom-color: var(--verdigris);
		color: var(--bone);
	}
	.label {
		display: inline-block;
		margin: 0 0 1rem;
		padding: 0.25rem 0.75rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		color: var(--mist);
		font-family: var(--font-display);
		font-size: 0.8125rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.paragraph,
	.epitaph {
		margin: 0;
		padding-left: 1rem;
		border-left: 2px solid var(--bone);
		font-family: var(--font-serif);
		font-size: 1.25rem;
		line-height: 1.6;
	}
	.epitaph p {
		margin: 0 0 0.5rem;
	}
	.disclaimer,
	.cite {
		margin: 0.75rem 0 0;
		color: var(--mist);
		font-size: 0.9375rem;
	}
	.eyebrow {
		margin-bottom: 0.75rem;
	}
	.facts {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.5rem 1.5rem;
		margin: 0;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--slate);
	}
	.facts dt {
		color: var(--mist);
	}
	.facts dd {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 1.0625rem;
	}
	.links {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.links li {
		margin: 0.375rem 0;
		overflow-wrap: anywhere;
	}
	.links small {
		margin-left: 0.5rem;
		color: var(--mist);
	}
	.again {
		width: 100%;
		margin-top: 2rem;
	}
	/* Text surfaces as if out of fog: a downward mask wipe with a slight rise. */
	.reveal {
		mask-image: linear-gradient(#000 66%, transparent);
		mask-repeat: no-repeat;
		mask-size: 100% 300%;
	}
	@keyframes reveal {
		from {
			opacity: 0;
			transform: translateY(0.5rem);
			mask-position: 0 100%;
		}
		to {
			opacity: 1;
			transform: none;
			mask-position: 0 0;
		}
	}
	/* Motion runs only on mouse-driven screens: phones are too slow for it. */
	@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
		.reveal {
			animation: reveal 1.4s ease-out both;
		}
	}
</style>
