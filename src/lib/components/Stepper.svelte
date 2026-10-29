<script lang="ts">
	const STEPS = ['Photo', 'Searching', 'Story'] as const;

	let { current }: { current: 1 | 2 } = $props();
</script>

<ol aria-label="Progress">
	{#each STEPS as label, i (label)}
		<li
			class:done={i < current}
			class:current={i === current}
			aria-current={i === current ? 'step' : undefined}
		>
			<span class="dot" aria-hidden="true">
				{#if i < current}
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
						><path d="M2.5 6.5 5 9l4.5-6" stroke-width="1.8" /></svg
					>
				{/if}
			</span>
			<span class="eyebrow">{label}</span>
		</li>
	{/each}
</ol>

<style>
	ol {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin: 0 0 1.25rem;
		padding: 0;
		list-style: none;
	}
	li {
		position: relative;
		display: grid;
		justify-items: center;
		gap: 0.5rem;
	}
	/* Connector to the next step; drawn from each dot's centre so it meets the next one. */
	li:not(:last-child)::after {
		position: absolute;
		top: 0.625rem;
		left: calc(50% + 0.75rem);
		width: calc(100% - 1.5rem);
		height: 1px;
		background: var(--line);
		content: '';
	}
	li.done:not(:last-child)::after {
		background: var(--verdigris);
	}
	.dot {
		display: grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		border: 1px solid var(--line);
		border-radius: 50%;
		color: var(--ink);
	}
	.done .dot {
		border-color: var(--verdigris);
		background: var(--verdigris);
	}
	.current .dot {
		border-color: var(--verdigris);
		background: radial-gradient(circle, var(--verdigris) 40%, transparent 45%);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--verdigris) 25%, transparent);
	}
	.eyebrow {
		font-size: 0.8125rem;
	}
	.current .eyebrow {
		color: var(--verdigris);
	}
</style>
