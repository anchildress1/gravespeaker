<script lang="ts">
	import type { Voice } from '#lib/types.ts';

	let { text, voice: guessed }: { text: string; voice: Voice } = $props();

	const LABELS: Record<Voice, string> = { female: 'Female voice', male: 'Male voice' };
	const STATUS = {
		idle: 'Hear their story',
		loading: 'Summoning…',
		playing: 'Speaking…',
		failed: 'Narration failed. Try again.'
	} as const;

	// Starts on the server's guess; the visitor's pick overrides it.
	let voice = $derived(guessed);
	let status = $state<keyof typeof STATUS>('idle');
	let audio: HTMLAudioElement;
	const src = $derived(`/api/narrate?${new URLSearchParams({ text, voice })}`);

	/** Plays or pauses the narration. */
	function toggle(): void {
		if (audio.paused) {
			// A failed load also fires the element's error event, which owns the failure message.
			audio.play().catch(() => {});
		} else audio.pause();
	}
</script>

<div class="bar">
	<audio
		bind:this={audio}
		{src}
		preload="none"
		onplay={() => (status = 'loading')}
		onwaiting={() => (status = 'loading')}
		onplaying={() => (status = 'playing')}
		onpause={() => status !== 'failed' && (status = 'idle')}
		onended={() => (status = 'idle')}
		onemptied={() => (status = 'idle')}
		onerror={() => (status = 'failed')}
	></audio>
	<button
		type="button"
		class="play"
		aria-label={status === 'idle' || status === 'failed' ? 'Play narration' : 'Pause narration'}
		onclick={toggle}
	>
		<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
			{#if status === 'idle' || status === 'failed'}
				<path d="M5 3.5v11l9-5.5z" />
			{:else}
				<path d="M4.5 3.5h3v11h-3zM10.5 3.5h3v11h-3z" />
			{/if}
		</svg>
	</button>
	<p aria-live="polite">{STATUS[status]}</p>
	<label>
		<span class="visually-hidden">Voice</span>
		<select bind:value={voice}>
			{#each Object.entries(LABELS) as [id, label] (id)}
				<option value={id}>{label}</option>
			{/each}
		</select>
	</label>
</div>

<style>
	.bar {
		position: fixed;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		max-width: 30rem;
		margin: 0 auto;
		padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
		border-top: 1px solid var(--line);
		background: color-mix(in srgb, var(--slate) 92%, transparent);
		backdrop-filter: blur(8px);
	}
	.play {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: none;
		color: var(--bone);
		cursor: pointer;
	}
	p {
		flex: 1;
		margin: 0;
		color: var(--mist);
		font-size: 0.875rem;
	}
	select {
		min-height: 2.75rem;
		padding: 0 0.75rem;
		border: 1px solid var(--line);
		border-radius: 0.375rem;
		background: var(--ink);
		color: var(--bone);
	}
</style>
