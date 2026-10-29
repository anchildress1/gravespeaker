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
