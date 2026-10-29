<script lang="ts">
	import ErrorNotice from './ErrorNotice.svelte';

	let { onphoto }: { onphoto: (file: File) => void } = $props();

	let dialog: HTMLDialogElement;
	let video: HTMLVideoElement;
	let stream: MediaStream | null = null;
	// Each open bumps this, so a camera that starts after its window was closed or reopened is released.
	let request = 0;
	let ready = $state(false);
	let error = $state('');

	/**
	 * Opens the viewfinder and starts the camera, preferring the one facing away from the visitor.
	 * @returns Resolves once the camera is live or its failure is shown.
	 */
	export async function open(): Promise<void> {
		const mine = ++request;
		error = '';
		dialog.showModal();
		try {
			const started = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
				audio: false
			});
			if (mine !== request || !dialog.open) return started.getTracks().forEach((t) => t.stop());
			stream = started;
			video.srcObject = stream;
		} catch (e) {
			if (mine !== request) return;
			error =
				e instanceof DOMException && e.name === 'NotAllowedError'
					? 'Camera access was blocked. Allow it in your browser, or upload a photo instead.'
					: 'No camera could be started. Upload a photo instead.';
		}
	}

	/**
	 * Turns the camera off whenever the dialog closes, by any route.
	 */
	function stop(): void {
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		video.srcObject = null;
		ready = false;
	}

	/**
	 * Grabs the current frame as a JPEG and hands it on.
	 */
	function snap(): void {
		const canvas = document.createElement('canvas');
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		canvas.getContext('2d')?.drawImage(video, 0, 0);
		canvas.toBlob(
			(blob) => {
				if (!blob) return;
				dialog.close();
				onphoto(new File([blob], 'headstone.jpg', { type: 'image/jpeg' }));
			},
			'image/jpeg',
			0.92
		);
	}
</script>

<dialog bind:this={dialog} onclose={stop} aria-labelledby="camera-title">
	<h2 id="camera-title" class="eyebrow">Camera</h2>
	{#if error}<ErrorNotice message={error} retry={null} />{/if}
	<video
		bind:this={video}
		hidden={!!error}
		autoplay
		muted
		playsinline
		onplaying={() => (ready = true)}
	></video>
	<div class="controls">
		<button type="button" class="button quiet" onclick={() => dialog.close()}>Cancel</button>
		{#if !error}
			<button type="button" class="button" disabled={!ready} onclick={snap}>Take photo</button>
		{/if}
	</div>
</dialog>

<style>
	dialog {
		width: min(100% - 2rem, 48rem);
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		background: var(--slate);
		color: var(--bone);
	}
	dialog::backdrop {
		background: rgb(11 13 18 / 0.85);
	}
	h2 {
		margin-bottom: 0.75rem;
	}
	video {
		display: block;
		width: 100%;
		border-radius: 0.5rem;
		background: var(--ink);
	}
	video[hidden] {
		display: none;
	}
	.controls {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	.button:disabled {
		opacity: 0.5;
		cursor: wait;
	}
</style>
