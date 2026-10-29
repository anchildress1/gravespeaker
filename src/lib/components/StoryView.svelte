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
		<nav aria-label="Sections">
			<a href="#story">Story</a>
			<a href="#facts">Facts</a>
			<a href="#sources">Sources</a>
		</nav>

		<section id="story" class="reveal">
			<p class="label">Story generated with AI</p>
			<p class="paragraph">{story.paragraph}</p>
			<p class="disclaimer">
				An AI reconstruction written from the linked records. It is not testimony.
			</p>
		</section>

		<section id="facts" class="reveal later">
			<h3 class="eyebrow">Key facts</h3>
			<dl class="facts">
				<dt>Born</dt>
				<dd>{person.born ?? 'unknown'}</dd>
				<dt>Died</dt>
				<dd>{person.died ?? 'unknown'}</dd>
			</dl>
			<p class="cite">From the headstone.</p>
		</section>

		<section id="sources" class="reveal latest">
			<h3 class="eyebrow">Sources</h3>
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
		</section>
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
	nav {
		position: sticky;
		z-index: 1;
		top: 0;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin: 1rem 0;
		border-bottom: 1px solid var(--line);
		background: var(--ink);
	}
	nav a {
		padding: 0.75rem 0;
		color: var(--mist);
		font-family: var(--font-display);
		font-size: 0.75rem;
		letter-spacing: 0.16em;
		text-align: center;
		text-decoration: none;
		text-transform: uppercase;
	}
	nav a:first-child {
		border-bottom: 2px solid var(--verdigris);
		color: var(--bone);
	}
	section + section {
		margin-top: 1.75rem;
	}
	section {
		scroll-margin-top: 3.5rem;
	}
	.label {
		display: inline-block;
		margin: 0 0 1rem;
		padding: 0.25rem 0.75rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		color: var(--mist);
		font-family: var(--font-display);
		font-size: 0.6875rem;
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
		font-size: 0.8125rem;
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
		animation: reveal 1.4s ease-out both;
	}
	.later {
		animation-delay: 0.6s;
	}
	.latest {
		animation-delay: 0.9s;
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
</style>
