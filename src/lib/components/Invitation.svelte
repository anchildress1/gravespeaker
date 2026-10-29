<script lang="ts">
	import ErrorNotice from './ErrorNotice.svelte';
	import Moon from './Moon.svelte';

	let {
		message,
		retry,
		onphoto
	}: { message: string; retry: (() => void) | null; onphoto: (event: Event) => void } = $props();
</script>

<section class="invitation">
	<div class="scene" aria-hidden="true">
		<img src="/invitation.webp" alt="" width="640" height="887" fetchpriority="high" />
		<div class="lantern"></div>
		<div class="fog fog-back"></div>
		<div class="fog fog-front"></div>
	</div>

	<div class="masthead">
		<span class="moon"><Moon size={40} /></span>
		<h1>Gravespeaker</h1>
		<p class="tag">Every stone has a story. Let it speak.</p>
	</div>

	<div class="actions">
		{#if message}<ErrorNotice {message} {retry} />{/if}
		<label class="button capture">
			<svg
				width="22"
				height="22"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				aria-hidden="true"
			>
				<path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
				<circle cx="12" cy="13" r="3.5" />
			</svg>
			Photograph a headstone
			<input
				type="file"
				accept="image/*"
				capture="environment"
				onchange={onphoto}
				class="visually-hidden"
			/>
		</label>
		<details>
			<summary class="eyebrow">How it works</summary>
			<p>
				Point your camera at a headstone. The name and dates are read from the stone, matched to
				public records you confirm, and told back in the first person, with every source linked.
			</p>
			<p class="fine">Photos are read in memory and never stored. Up to 10 MB.</p>
		</details>
	</div>
</section>

<style>
	.invitation {
		position: relative;
		display: grid;
		grid-template-rows: auto 1fr auto;
		min-height: 100svh;
		overflow: hidden;
		isolation: isolate;
	}
	.scene {
		position: absolute;
		z-index: -1;
		inset: 0;
	}
	.scene img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: 40% 60%;
	}
	/* Fades the photo into ink at the top (title) and bottom (actions) so text stays legible. */
	.scene::after {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			var(--ink) 0%,
			color-mix(in srgb, var(--ink) 55%, transparent) 30%,
			transparent 55%,
			color-mix(in srgb, var(--ink) 70%, transparent) 78%,
			var(--ink) 100%
		);
		content: '';
	}
	/* On wide screens the column sits in open ink; fade the photo's sides so it has no hard edge. */
	@media (min-width: 40rem) {
		.scene {
			mask-image: linear-gradient(90deg, transparent, #000 20%, #000 80%, transparent);
		}
	}
	.fog {
		position: absolute;
		inset: auto -50% 8% -50%;
		height: 45%;
		background:
			radial-gradient(ellipse 30% 40% at 30% 60%, rgb(200 205 210 / 0.18), transparent 70%),
			radial-gradient(ellipse 25% 35% at 70% 50%, rgb(200 205 210 / 0.14), transparent 70%);
		filter: blur(12px);
		animation: drift 48s ease-in-out infinite alternate;
	}
	.fog-front {
		bottom: 0;
		height: 30%;
		opacity: 0.8;
		animation-duration: 36s;
		animation-direction: alternate-reverse;
	}
	.lantern {
		position: absolute;
		bottom: 22%;
		left: 8%;
		width: 9rem;
		height: 9rem;
		border-radius: 50%;
		background: radial-gradient(circle, rgb(242 166 90 / 0.6), rgb(242 166 90 / 0) 65%);
		mix-blend-mode: screen;
		animation: flicker 4.3s steps(1, end) infinite;
	}
	@keyframes drift {
		from {
			transform: translateX(-12%);
		}
		to {
			transform: translateX(12%);
		}
	}
	/* Uneven stops so the flicker never reads as a regular pulse. */
	@keyframes flicker {
		0%,
		100% {
			opacity: 0.85;
			transform: scale(1);
		}
		7% {
			opacity: 0.65;
		}
		9% {
			opacity: 0.9;
			transform: scale(1.03);
		}
		38% {
			opacity: 0.75;
		}
		41% {
			opacity: 1;
			transform: scale(0.98);
		}
		73% {
			opacity: 0.7;
		}
		76% {
			opacity: 0.88;
			transform: scale(1.02);
		}
	}
	.masthead {
		display: grid;
		justify-items: center;
		padding: 3rem 1rem 0;
		text-align: center;
	}
	.moon {
		color: var(--mist);
	}
	h1 {
		margin: 0.75rem 0 0.25rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 9vw, 2.75rem);
		font-weight: 400;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		text-shadow: 0 2px 12px rgb(0 0 0 / 0.8);
	}
	.tag {
		margin: 0;
		color: var(--bone);
		font-family: var(--font-serif);
		font-size: 1.125rem;
		font-style: italic;
	}
	.actions {
		display: grid;
		grid-row: 3;
		gap: 1rem;
		padding: 0 1rem 2rem;
	}
	.capture {
		min-height: 3.25rem;
		gap: 0.625rem;
		font-size: 0.875rem;
		letter-spacing: 0.08em;
		white-space: nowrap;
		background: color-mix(in srgb, var(--verdigris-deep) 70%, transparent);
		backdrop-filter: blur(4px);
	}
	details {
		color: var(--mist);
		text-align: center;
	}
	summary {
		padding: 0.75rem;
		list-style: none;
		cursor: pointer;
	}
	summary::after {
		content: ' ⌄' / '';
	}
	details p {
		margin: 0.5rem 0 0;
		font-family: var(--font-serif);
		font-size: 1.0625rem;
		color: var(--bone);
	}
	details .fine {
		font-family: var(--font-ui);
		font-size: 0.8125rem;
		color: var(--mist);
	}
</style>
