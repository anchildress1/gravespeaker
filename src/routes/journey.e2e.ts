import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

const hawks = {
	carvedName: 'Gaynor Claire Hawks née Staples',
	name: 'Gaynor Claire Hawks',
	maidenName: 'Staples',
	born: '1932-03-10',
	died: '2017-12-27'
};
const source = {
	id: 's1',
	url: 'https://legacy.com/hawks',
	title: 'Hawks obituary',
	site: 'legacy.com',
	snippet: ''
};
const candidate = {
	name: 'Gaynor Claire Hawks',
	born: '1932-03-10',
	died: '2017-12-27',
	place: null,
	confidence: 'high',
	sources: [source]
};
const told = {
	status: 'told',
	paragraph:
		'Come closer, and mind the cold. I taught piano for forty years. The garden remembers me.',
	sources: [source]
};

/**
 * Mocks one endpoint with a queue of responses; the last repeats.
 * @param page Page under test.
 * @param path Endpoint path.
 * @param replies Responses in order.
 * @returns Resolves when the route is installed.
 */
async function mock(page: Page, path: string, ...replies: { status?: number; body: unknown }[]) {
	let i = 0;
	await page.route(path, (route) => {
		const r = replies[Math.min(i++, replies.length - 1)];
		return route.fulfill({ status: r.status ?? 200, json: r.body });
	});
}

/**
 * Uploads a tiny image through the capture input.
 * @param page Page under test.
 * @returns Resolves when the file is chosen.
 */
async function upload(page: Page) {
	await page.goto('/');
	await page
		.locator('input[type=file]')
		.setInputFiles({ name: 's.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3]) });
}

test('a read shows read-only fields and waits for confirmation', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await upload(page);
	await expect(page.getByRole('heading', { name: 'Is this them?' })).toBeVisible();
	await expect(page.getByLabel('Read from the stone')).toContainText('Gaynor Claire Hawks');
	await expect(page.getByLabel('Read from the stone')).not.toContainText('Staples');
	await expect(page.getByText('High confidence match')).toBeVisible();
	await expect(page.getByRole('textbox')).toHaveCount(0);
});

test('no legible name offers another photo', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [] } });
	await upload(page);
	await expect(page.getByRole('alert')).toContainText('No legible name');
	await expect(page.getByText('Photograph a headstone')).toBeVisible();
});

test('two people show a picker', async ({ page }) => {
	await mock(page, '/api/read', {
		body: { people: [hawks, { ...hawks, name: 'Arthur Hawks', carvedName: 'Arthur Hawks' }] }
	});
	await mock(page, '/api/research', { body: { candidates: [] } });
	await upload(page);
	await expect(page.getByRole('heading', { name: 'Whose story?' })).toBeVisible();
	await page.getByRole('button', { name: /Arthur Hawks/ }).click();
	await expect(page.getByText('My name was Gaynor Claire Hawks.')).toHaveCount(0);
	await expect(page.getByText('My name was Arthur Hawks.')).toBeVisible();
});

test('"none of these" ends on the stone-only epitaph with no AI label', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await upload(page);
	await page.getByRole('button', { name: 'None of these' }).click();
	await expect(page.getByText('My name was Gaynor Claire Hawks.')).toBeVisible();
	await expect(page.getByText('I was born on March 10, 1932.')).toBeVisible();
	await expect(page.getByText('No public record was confirmed')).toBeVisible();
	await expect(page.getByText('generated with AI')).toHaveCount(0);
});

test('zero candidates show the epitaph with the no-records note', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [] } });
	await upload(page);
	await expect(page.getByText('No public records were found')).toBeVisible();
});

test('a failed research shows the message and retries', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(
		page,
		'/api/research',
		{ status: 502, body: { error: { code: 'provider_failed', message: 'Lookup failed.' } } },
		{ body: { candidates: [candidate] } }
	);
	await upload(page);
	await expect(page.getByRole('alert')).toContainText('Lookup failed.');
	await page.getByRole('button', { name: 'Try again' }).click();
	await expect(page.getByRole('heading', { name: 'Is this them?' })).toBeVisible();
});

test('a told story is one labelled paragraph with its sources listed', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(page, '/api/story', { body: told });
	await upload(page);
	await page.getByRole('button', { name: 'This is them' }).click();
	await expect(page.getByText('Story generated with AI')).toBeVisible();
	await expect(page.locator('.paragraph')).toContainText('I taught piano for forty years.');
	await expect(page.getByRole('link', { name: source.title })).toHaveAttribute('href', source.url);
});

test('an insufficient story falls back to the epitaph without the AI label', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(page, '/api/story', { body: { status: 'insufficient' } });
	await upload(page);
	await page.getByRole('button', { name: 'This is them' }).click();
	await expect(page.getByText('The records hold nothing beyond the stone')).toBeVisible();
	await expect(page.getByText('generated with AI')).toHaveCount(0);
});

test('a failed story shows the message and retries', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(
		page,
		'/api/story',
		{ status: 502, body: { error: { code: 'provider_failed', message: 'Story failed.' } } },
		{ body: told }
	);
	await upload(page);
	await page.getByRole('button', { name: 'This is them' }).click();
	await expect(page.getByRole('alert')).toContainText('Story failed.');
	await page.getByRole('button', { name: 'Try again' }).click();
	await expect(page.getByText('Story generated with AI')).toBeVisible();
});

test('a photo over 10 MB is rejected in the browser without an upload', async ({ page }) => {
	let uploaded = false;
	await page.route('/api/read', (route) => {
		uploaded = true;
		return route.fulfill({ json: { people: [] } });
	});
	await page.goto('/');
	await page.locator('input[type=file]').setInputFiles({
		name: 'big.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.alloc(11 * 1024 * 1024)
	});
	await expect(page.getByRole('alert')).toContainText('over 10 MB');
	expect(uploaded).toBe(false);
});

test('a non-JSON 413 from the server shows the too-large message', async ({ page }) => {
	await page.route('/api/read', (route) =>
		route.fulfill({ status: 413, contentType: 'text/plain', body: 'Payload Too Large' })
	);
	await upload(page);
	await expect(page.getByRole('alert')).toContainText('over 10 MB');
});

test('a network failure shows a message and retries the same photo', async ({ page }) => {
	let calls = 0;
	await page.route('/api/read', (route) =>
		calls++ === 0 ? route.abort() : route.fulfill({ json: { people: [] } })
	);
	await upload(page);
	await expect(page.getByRole('alert')).toContainText('Could not reach the server');
	await page.getByRole('button', { name: 'Try again' }).click();
	await expect(page.getByRole('alert')).toContainText('No legible name');
});

test('the upload control can be reached and focused from the keyboard', async ({ page }) => {
	await page.goto('/');
	await page.keyboard.press('Tab');
	await expect(page.locator('input[type=file]')).toBeFocused();
});

test('a focused button stays visible so keyboard users can see it', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await upload(page);
	const confirm = page.getByRole('button', { name: 'This is them' });
	// Tab, not focus(): only keyboard focus triggers :focus-visible.
	for (let i = 0; i < 6 && !(await confirm.evaluate((el) => el === document.activeElement)); i++) {
		await page.keyboard.press('Tab');
	}
	await expect(confirm).toBeFocused();
	// The visually-hidden rule must not leak onto focused buttons.
	const clip = await confirm.evaluate((el) => getComputedStyle(el).clipPath);
	expect(clip).toBe('none');
});

test('a low-confidence match tells the visitor to check the sources', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', {
		body: { candidates: [{ ...candidate, confidence: 'low' }] }
	});
	await upload(page);
	await expect(page.getByText(/Low confidence match/)).toContainText('Check the sources');
});
