import { expect, test } from '@playwright/test';

// A desktop with a webcam: Chromium's fake camera stands in for the device and its permission prompt.
test.use({
	viewport: { width: 1280, height: 800 },
	isMobile: false,
	hasTouch: false,
	permissions: ['camera'],
	launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
});

test('on a desktop, photographing opens a live camera and sends the shot to be read', async ({
	page
}) => {
	let sent = '';
	await page.route('/api/read', (route) => {
		sent = route.request().postDataBuffer()?.toString('latin1') ?? '';
		return route.fulfill({ json: { people: [] } });
	});
	await page.goto('/');
	await page.waitForLoadState('networkidle');

	await page.getByText('Photograph a headstone').click();
	const camera = page.getByRole('dialog', { name: 'Camera' });
	await expect(camera.locator('video')).toBeVisible();
	await camera.getByRole('button', { name: 'Take photo' }).click();

	await expect(camera).toBeHidden();
	await expect(page.getByRole('alert')).toContainText('No legible name');
	expect(sent).toContain('Content-Type: image/jpeg');
});

test('cancelling the camera returns to the invitation with the camera off', async ({ page }) => {
	await page.addInitScript(() => {
		const start = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		navigator.mediaDevices.getUserMedia = async (c) => {
			const stream = await start(c);
			Object.assign(window, { cameraStream: stream });
			return stream;
		};
	});
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.getByText('Photograph a headstone').click();
	const camera = page.getByRole('dialog', { name: 'Camera' });
	await expect(camera.locator('video')).toBeVisible();

	await camera.getByRole('button', { name: 'Cancel' }).click();

	await expect(camera).toBeHidden();
	// The dialog's close event, which stops the camera, fires a task after it hides.
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as { cameraStream: MediaStream }).cameraStream
					.getTracks()
					.map((t) => t.readyState)
			)
		)
		.toEqual(['ended']);
});

test('a blocked camera says so and points to the upload', async ({ page }) => {
	await page.addInitScript(() => {
		navigator.mediaDevices.getUserMedia = () =>
			Promise.reject(new DOMException('denied', 'NotAllowedError'));
	});
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.getByText('Photograph a headstone').click();

	const camera = page.getByRole('dialog', { name: 'Camera' });
	await expect(camera.getByRole('alert')).toContainText('Camera access was blocked');
	await expect(camera.getByRole('button', { name: 'Take photo' })).toHaveCount(0);
});

test('reopening the camera before the first one starts leaves only one camera on', async ({
	page
}) => {
	await page.addInitScript(() => {
		const start = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		const streams: MediaStream[] = [];
		Object.assign(window, { cameraStreams: streams });
		let calls = 0;
		// The first request answers late, as a slow permission prompt does.
		navigator.mediaDevices.getUserMedia = async (c) => {
			const late = calls++ === 0;
			const stream = await start(c);
			streams[late ? 0 : 1] = stream;
			if (late) await new Promise((r) => setTimeout(r, 800));
			return stream;
		};
	});
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const camera = page.getByRole('dialog', { name: 'Camera' });
	await page.getByText('Photograph a headstone').click();
	await camera.getByRole('button', { name: 'Cancel' }).click();
	await page.getByText('Photograph a headstone').click();
	await expect(camera.getByRole('button', { name: 'Take photo' })).toBeEnabled();

	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as { cameraStreams: MediaStream[] }).cameraStreams.map(
					(s) => s.getVideoTracks()[0].readyState
				)
			)
		)
		.toEqual(['ended', 'live']);
});

test('taking a photo turns the camera off as the page moves on', async ({ page }) => {
	await page.addInitScript(() => {
		const start = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		navigator.mediaDevices.getUserMedia = async (c) => {
			const stream = await start(c);
			Object.assign(window, { cameraStream: stream });
			return stream;
		};
	});
	// The read never answers, so the check runs while the stone is still being read.
	await page.route('/api/read', () => new Promise(() => {}));
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.getByText('Photograph a headstone').click();
	const camera = page.getByRole('dialog', { name: 'Camera' });
	await camera.getByRole('button', { name: 'Take photo' }).click();
	await expect(page.getByRole('status')).toHaveText('Reading the stone…');

	const tracks = await page.evaluate(() =>
		(window as unknown as { cameraStream: MediaStream }).cameraStream
			.getTracks()
			.map((t) => t.readyState)
	);
	expect(tracks).toEqual(['ended']);
});
