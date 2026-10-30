<script lang="ts">
	let { message, retry }: { message: string; retry: (() => void) | null } = $props();
</script>

<div class="error" role="alert">
	<p>{message}</p>
	<!-- Focus lands on the retry, so a keyboard user is not left on a control that is gone. -->
	{#if retry}<button
			type="button"
			class="button quiet"
			onclick={() => retry?.()}
			{@attach (b) => b.focus()}>Try again</button
		>{/if}
</div>

<style>
	.error {
		display: grid;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid #b4574f;
		border-radius: 0.5rem;
		background: color-mix(in srgb, #b4574f 12%, var(--slate));
	}
	p {
		margin: 0;
	}
</style>
