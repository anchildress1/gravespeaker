<!-- Placeholder until voice narration lands: every control is present but disabled. -->
<div class="bar">
	<button type="button" class="play" aria-label="Play narration" disabled>
		<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"
			><path d="M5 3.5v11l9-5.5z" /></svg
		>
	</button>
	<p>Narration coming soon</p>
	<label>
		<span class="visually-hidden">Voice</span>
		<select disabled>
			<option>Voice</option>
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
		color: var(--mist-dim);
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
		color: var(--mist-dim);
	}
</style>
