<script lang="ts">
	let { onback }: { onback: () => void } = $props();
</script>

<header>
	<button type="button" class="back" aria-label="Start over" onclick={onback}>
		<svg
			width="22"
			height="22"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			aria-hidden="true"
		>
			<path d="M20 12H4M10 6l-6 6 6 6" />
		</svg>
	</button>
	<h1>Gravespeaker</h1>
</header>

<style>
	header {
		display: grid;
		grid-template-columns: 2.75rem 1fr 2.75rem;
		align-items: center;
		padding: 0.75rem 0;
	}
	.back {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--bone);
		cursor: pointer;
	}
	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.125rem;
		font-weight: 400;
		letter-spacing: 0.12em;
		text-align: center;
		text-transform: uppercase;
	}
</style>
