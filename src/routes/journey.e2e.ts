import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

const hawks = {
	carvedName: 'Gaynor Claire Hawks née Staples',
	name: 'Gaynor Claire Hawks',
	maidenName: 'Staples',
	born: '1932-03-10',
	died: '2017-12-27',
	voice: 'female',
	place: null
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
	confidence: 'high',
	sources: [source]
};
// The stone story when none of the model's sentences survived grounding.
const bareStone = { status: 'stone', paragraph: null, voice: 'female' };
const told = {
	status: 'told',
	paragraph:
		'Come closer, and mind the cold. I taught piano for forty years. The garden remembers me.',
	confidence: 'medium',
	sources: [source],
	voice: 'male'
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
	// A file chosen before hydration is ignored; a slow runner shows it.
	await page.waitForLoadState('networkidle');
	await page
		.getByLabel('Upload a photo')
		.setInputFiles({ name: 's.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3]) });
}

test('a read shows read-only fields while the story is built', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	const gate = Promise.withResolvers<void>();
	await page.route('/api/story', async (route) => {
		await gate.promise;
		await route.fulfill({ json: told });
	});
	await upload(page);
	await expect(page.getByRole('status')).toHaveText('Building the story…');
	await expect(page.getByLabel('Read from the stone')).toContainText('Gaynor Claire Hawks');
	await expect(page.getByLabel('Read from the stone')).not.toContainText('Staples');
	await expect(page.getByRole('textbox')).toHaveCount(0);
	gate.resolve();
});

test('the best match is told without asking the visitor', async ({ page }) => {
	const other = { ...candidate, born: '1932', died: null, confidence: 'medium' };
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate, other] } });
	let sent: unknown;
	await page.route('/api/story', (route) => {
		sent = route.request().postDataJSON();
		return route.fulfill({ json: told });
	});
	await upload(page);
	await expect(page.getByText('Story generated with AI')).toBeVisible();
	expect(sent).toEqual({ inscription: hawks, candidate });
});

test("sends the visitor's location with the photo when allowed", async ({ page, context }) => {
	await context.grantPermissions(['geolocation']);
	await context.setGeolocation({ latitude: 44.4263, longitude: -123.6162 });
	let sent: string | null = null;
	await page.route('/api/read', (route) => {
		sent = route.request().postData();
		return route.fulfill({ json: { people: [] } });
	});
	await upload(page);
	await expect(page.getByRole('alert')).toContainText('No legible name');
	expect(sent).toContain('44.4263');
	expect(sent).toContain('-123.6162');
});

test('reads the photo without a location when it is denied', async ({ page }) => {
	let sent: string | null = null;
	await page.route('/api/read', (route) => {
		sent = route.request().postData();
		return route.fulfill({ json: { people: [] } });
	});
	await upload(page);
	await expect(page.getByRole('alert')).toContainText('No legible name');
	expect(sent).not.toContain('name="lat"');
});

test('shows the town searched near with the map credit', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [{ ...hawks, place: 'Alsea, Oregon' }] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	// Held, so the page stays on the search screen while it is checked.
	const gate = Promise.withResolvers<void>();
	await page.route('/api/story', async (route) => {
		await gate.promise;
		await route.fulfill({ json: told });
	});
	await upload(page);
	await expect(page.getByText('Searching near Alsea, Oregon')).toBeVisible();
	await expect(page.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeVisible();
	await expect(page.getByLabel('Read from the stone')).not.toContainText('Alsea');
	gate.resolve();
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
	await mock(page, '/api/story', { body: bareStone });
	await upload(page);
	await expect(page.getByRole('heading', { name: 'Whose story?' })).toBeVisible();
	await page.getByRole('button', { name: /Arthur Hawks/ }).click();
	await expect(page.getByText('My name was Gaynor Claire Hawks.')).toHaveCount(0);
	await expect(page.getByText('My name was Arthur Hawks.')).toBeVisible();
});

test('zero candidates with no surviving sentence show the plain epitaph and the no-records note', async ({
	page
}) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [] } });
	await mock(page, '/api/story', { body: bareStone });
	await upload(page);
	await expect(page.getByText('My name was Gaynor Claire Hawks.')).toBeVisible();
	await expect(page.getByText('I was born on March 10, 1932.')).toBeVisible();
	await expect(page.getByText('No public records were found')).toBeVisible();
	await expect(page.getByText('generated with AI')).toHaveCount(0);
});

test('a failed research shows the message and retries', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(
		page,
		'/api/research',
		{ status: 502, body: { error: { code: 'provider_failed', message: 'Lookup failed.' } } },
		{ body: { candidates: [candidate] } }
	);
	await mock(page, '/api/story', { body: told });
	await upload(page);
	await expect(page.getByRole('alert')).toContainText('Lookup failed.');
	await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
	await page.getByRole('button', { name: 'Try again' }).click();
	await expect(page.getByText('Story generated with AI')).toBeVisible();
});

test('a told story is one labelled paragraph with its sources listed', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(page, '/api/story', { body: told });
	await upload(page);
	await expect(page.getByText('Story generated with AI')).toBeVisible();
	await expect(page.locator('.paragraph')).toContainText('I taught piano for forty years.');
	await page.getByRole('tab', { name: 'Sources' }).click();
	await expect(page.getByRole('link', { name: source.title })).toHaveAttribute('href', source.url);
});

test('a told story shows the grade of the person it picked; a stone story shows none', async ({
	page
}) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(
		page,
		'/api/research',
		{ body: { candidates: [candidate] } },
		{ body: { candidates: [candidate] } },
		{ body: { candidates: [] } }
	);
	await mock(
		page,
		'/api/story',
		{ body: told },
		{ body: { ...told, confidence: 'high' } },
		{ body: bareStone }
	);
	await upload(page);
	await expect(page.getByRole('region', { name: 'Who this is' })).toContainText(
		'Medium confidence: the name and one date match the records'
	);
	await page.getByRole('button', { name: 'Try another photo' }).click();
	await page
		.getByLabel('Upload a photo')
		.setInputFiles({ name: 's.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3]) });
	await expect(page.getByRole('region', { name: 'Who this is' })).toContainText(
		'High confidence: the name and every date on the stone match the records'
	);
	await page.getByRole('button', { name: 'Try another photo' }).click();
	await page
		.getByLabel('Upload a photo')
		.setInputFiles({ name: 's.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3]) });
	await expect(page.getByText('No public records were found')).toBeVisible();
	await expect(page.getByText(/confidence/)).toHaveCount(0);
});

test('the story tabs show one section at a time and follow the arrow keys', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(page, '/api/story', { body: told });
	await upload(page);
	const story = page.getByRole('tab', { name: 'Story' });
	await expect(story).toHaveAttribute('aria-selected', 'true');
	await expect(page.locator('.paragraph')).toBeVisible();
	await expect(page.getByRole('link', { name: source.title })).toBeHidden();

	await page.getByRole('tab', { name: 'Facts' }).click();
	await expect(page.getByRole('tabpanel', { name: 'Facts' })).toContainText('Born');
	await expect(page.locator('.paragraph')).toBeHidden();

	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('tab', { name: 'Sources' })).toBeFocused();
	await expect(page.getByRole('link', { name: source.title })).toBeVisible();
	await page.keyboard.press('ArrowRight');
	await expect(story).toBeFocused();
	await expect(page.locator('.paragraph')).toBeVisible();
});

test('records with nothing beyond the stone fall back to the stone', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(page, '/api/story', { body: bareStone });
	await upload(page);
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
	await page.getByLabel('Upload a photo').setInputFiles({
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

test('the camera and upload controls can be reached from the keyboard', async ({ page }) => {
	await page.goto('/');
	await page.keyboard.press('Tab');
	await expect(page.getByLabel('Photograph a headstone')).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(page.getByLabel('Upload a photo')).toBeFocused();
});

test('the camera opens the rear camera while upload offers saved photos', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByLabel('Photograph a headstone')).toHaveAttribute('capture', 'environment');
	await expect(page.getByLabel('Upload a photo')).not.toHaveAttribute('capture');
	await expect(page.getByText('Upload a photo')).toBeInViewport();
});

test("on a phone, photographing hands off to the phone's own camera", async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const chooser = page.waitForEvent('filechooser');
	await page.getByText('Photograph a headstone').click();
	await chooser;
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a focused button stays visible so keyboard users can see it', async ({ page }) => {
	await mock(page, '/api/read', {
		body: { people: [hawks, { ...hawks, name: 'Arthur Hawks', carvedName: 'Arthur Hawks' }] }
	});
	await upload(page);
	const pick = page.getByRole('button', { name: /Arthur Hawks/ });
	// Tab, not focus(): only keyboard focus triggers :focus-visible.
	for (let i = 0; i < 6 && !(await pick.evaluate((el) => el === document.activeElement)); i++) {
		await page.keyboard.press('Tab');
	}
	await expect(pick).toBeFocused();
	// The visually-hidden rule must not leak onto focused buttons.
	const clip = await pick.evaluate((el) => getComputedStyle(el).clipPath);
	expect(clip).toBe('none');
});

test('the checklist ticks a step only when its request resolves', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	const gate = Promise.withResolvers<void>();
	await page.route('/api/research', async (route) => {
		await gate.promise;
		await route.fulfill({ json: { candidates: [candidate] } });
	});
	await page.route('/api/story', () => undefined);
	await upload(page);
	await expect(page.getByRole('listitem').filter({ hasText: 'Reading the stone' })).toContainText(
		'done'
	);
	await expect(
		page.getByRole('listitem').filter({ hasText: 'Searching historical records' })
	).toContainText('in progress');
	await expect(page.getByRole('listitem').filter({ hasText: 'Building the story' })).toContainText(
		'pending'
	);
	gate.resolve();
	await expect(
		page.getByRole('listitem').filter({ hasText: 'Searching historical records' })
	).toContainText('done');
	await expect(page.getByRole('listitem').filter({ hasText: 'Building the story' })).toContainText(
		'in progress'
	);
});

test('the uploaded photo stays with the visitor from search to story', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(page, '/api/story', { body: told });
	await upload(page);
	await expect(page.getByRole('img', { name: 'The headstone you uploaded' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Gaynor Claire Hawks' })).toBeVisible();
	await expect(page.getByRole('img', { name: 'The headstone you uploaded' })).toBeVisible();
});

test("the story header keeps the stone's full dates when the record has only years", async ({
	page
}) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', {
		body: { candidates: [{ ...candidate, born: '1932', died: '2017' }] }
	});
	await mock(page, '/api/story', { body: told });
	await upload(page);
	await expect(page.getByRole('region', { name: 'Who this is' })).toContainText(
		'1932-03-10 to 2017-12-27'
	);
});

test('narration is offered whenever there is a story paragraph', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(page, '/api/story', { body: told });
	await upload(page);
	await expect(page.getByRole('button', { name: 'Play narration' })).toBeEnabled();
	await page.getByRole('button', { name: 'Try another photo' }).click();
	await mock(page, '/api/story', { body: bareStone });
	await page
		.getByLabel('Upload a photo')
		.setInputFiles({ name: 's.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3]) });
	await expect(page.getByText('The records hold nothing beyond the stone')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Play narration' })).toHaveCount(0);
});

test('narration plays the story in the guessed voice, and the visitor can switch it', async ({
	page
}) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(page, '/api/story', { body: told });
	const asked: URLSearchParams[] = [];
	await page.route('/api/narrate?*', (route) => {
		asked.push(new URL(route.request().url()).searchParams);
		return route.fulfill({ status: 502, body: '' });
	});
	await upload(page);
	await expect(page.getByLabel('Voice')).toHaveValue('male');
	await page.getByLabel('Voice').selectOption('female');
	await page.getByRole('button', { name: 'Play narration' }).click();
	await expect(page.getByText('Narration failed. Try again.')).toBeVisible();
	expect(asked.at(-1)?.get('voice')).toBe('female');
	expect(asked.at(-1)?.get('text')).toBe(told.paragraph);
});

test('a failed narration is requested again on retry', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(page, '/api/story', { body: told });
	let asked = 0;
	await page.route('/api/narrate?*', (route) => {
		asked++;
		return route.fulfill({ status: 502, body: '' });
	});
	await upload(page);
	await page.getByRole('button', { name: 'Play narration' }).click();
	await expect(page.getByText('Narration failed. Try again.')).toBeVisible();
	const first = asked;
	await page.getByRole('button', { name: 'Play narration' }).click();
	await expect.poll(() => asked).toBeGreaterThan(first);
});

test('no match tells the stone alone, labelled as AI from the headstone', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [] } });
	let sent: unknown;
	await page.route('/api/story', (route) => {
		sent = route.request().postDataJSON();
		return route.fulfill({
			json: {
				status: 'stone',
				paragraph: 'Mind the cold. My name was Gaynor Claire Hawks.',
				voice: 'female'
			}
		});
	});
	await upload(page);
	await expect(page.locator('.paragraph')).toContainText('Mind the cold.');
	await expect(page.getByText('Story generated with AI')).toBeVisible();
	await expect(page.getByText('written from the headstone alone')).toBeVisible();
	await expect(page.getByText('No public records were found')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Play narration' })).toBeEnabled();
	expect(sent).toEqual({ inscription: hawks });
});

test('a failed stone story shows the message and retries', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [] } });
	await mock(
		page,
		'/api/story',
		{ status: 502, body: { error: { code: 'provider_failed', message: 'Story failed.' } } },
		{ body: { status: 'stone', paragraph: 'Mind the cold.', voice: 'female' } }
	);
	await upload(page);
	await expect(page.getByRole('alert')).toContainText('Story failed.');
	await page.getByRole('button', { name: 'Try again' }).click();
	await expect(page.locator('.paragraph')).toContainText('Mind the cold.');
});

test('starting over while the stone is being read drops the old request', async ({ page }) => {
	const gate = Promise.withResolvers<void>();
	await page.route('/api/read', async (route) => {
		await gate.promise;
		// The page aborts this request, so fulfilling it may be refused.
		await route.fulfill({ json: { people: [hawks] } }).catch(() => undefined);
	});
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await upload(page);
	await expect(page.getByRole('listitem').filter({ hasText: 'Reading the stone' })).toContainText(
		'in progress'
	);
	await page.getByRole('button', { name: 'Start over' }).click();
	const research = page.waitForRequest('**/api/research', { timeout: 1500 });
	gate.resolve();
	await expect(research).rejects.toThrow();
	await expect(page.getByText('Photograph a headstone')).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('key facts show only what the stone says, since a record date may be uncited', async ({
	page
}) => {
	await mock(page, '/api/read', { body: { people: [{ ...hawks, died: null }] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(page, '/api/story', { body: told });
	await upload(page);
	await page.getByRole('tab', { name: 'Facts' }).click();
	const facts = page.getByRole('tabpanel', { name: 'Facts' });
	await expect(facts).toContainText('From the headstone.');
	await expect(facts).toContainText('Gaynor Claire Hawks née Staples');
	await expect(facts).not.toContainText('2017');
	await expect(page.getByRole('region', { name: 'Who this is' })).toContainText(
		'1932-03-10 to unknown'
	);
});

test('search progress is announced to screen readers', async ({ page }) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	const gate = Promise.withResolvers<void>();
	await page.route('/api/research', async (route) => {
		await gate.promise;
		await route.fulfill({ json: { candidates: [candidate] } });
	});
	await page.route('/api/story', () => undefined);
	await upload(page);
	await expect(page.getByRole('status')).toHaveText('Searching historical records…');
	gate.resolve();
	await expect(page.getByRole('status')).toHaveText('Building the story…');
});

test('a finished story takes focus and is announced, so screen readers are not left behind', async ({
	page
}) => {
	await mock(page, '/api/read', { body: { people: [hawks] } });
	await mock(page, '/api/research', { body: { candidates: [candidate] } });
	await mock(page, '/api/story', { body: told });
	await upload(page);
	await expect(page.getByRole('heading', { name: 'Gaynor Claire Hawks' })).toBeFocused();
	await expect(page.getByRole('status')).toHaveText('Story ready.');
});

/**
 * Scans the page for WCAG 2.2 A and AA violations.
 * @param page Page under test.
 * @returns Resolves when the scan finds none.
 */
async function expectAccessible(page: Page) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}

test.describe('accessibility', () => {
	test('the invitation passes an automated WCAG scan', async ({ page }) => {
		await page.goto('/');
		await expectAccessible(page);
	});

	test('the person picker passes an automated WCAG scan', async ({ page }) => {
		await mock(page, '/api/read', {
			body: { people: [hawks, { ...hawks, name: 'Arthur Hawks', carvedName: 'Arthur Hawks' }] }
		});
		await upload(page);
		await expect(page.getByRole('button', { name: /Arthur Hawks/ })).toBeVisible();
		await expectAccessible(page);
	});

	test('the search progress passes an automated WCAG scan', async ({ page }) => {
		await mock(page, '/api/read', { body: { people: [{ ...hawks, place: 'Alsea, Oregon' }] } });
		const gate = Promise.withResolvers<void>();
		await page.route('/api/research', async (route) => {
			await gate.promise;
			await route.fulfill({ json: { candidates: [] } });
		});
		await upload(page);
		await expect(page.getByRole('status')).toHaveText('Searching historical records…');
		await expectAccessible(page);
		gate.resolve();
	});

	test('a told story passes an automated WCAG scan on every tab', async ({ page }) => {
		await mock(page, '/api/read', { body: { people: [hawks] } });
		await mock(page, '/api/research', { body: { candidates: [candidate] } });
		await mock(page, '/api/story', { body: told });
		await upload(page);
		await expect(page.getByText('Story generated with AI')).toBeVisible();
		for (const tab of ['Story', 'Facts', 'Sources']) {
			await page.getByRole('tab', { name: tab }).click();
			await expectAccessible(page);
		}
	});

	test('a stone story passes an automated WCAG scan', async ({ page }) => {
		await mock(page, '/api/read', { body: { people: [hawks] } });
		await mock(page, '/api/research', { body: { candidates: [] } });
		await mock(page, '/api/story', { body: bareStone });
		await upload(page);
		await expect(page.getByText('No public records were found')).toBeVisible();
		await expectAccessible(page);
	});

	test('an error with a retry passes an automated WCAG scan', async ({ page }) => {
		await mock(page, '/api/read', { body: { people: [hawks] } });
		await mock(page, '/api/research', {
			status: 502,
			body: { error: { code: 'provider_failed', message: 'Lookup failed.' } }
		});
		await upload(page);
		await expect(page.getByRole('alert')).toContainText('Lookup failed.');
		await expectAccessible(page);
	});

	test('a focused story button keeps a visible outline', async ({ page }) => {
		await mock(page, '/api/read', { body: { people: [hawks] } });
		await mock(page, '/api/research', { body: { candidates: [candidate] } });
		await mock(page, '/api/story', { body: told });
		await upload(page);
		const again = page.getByRole('button', { name: 'Try another photo' });
		await expect(again).toBeVisible();
		// Tab, not focus(): only keyboard focus triggers :focus-visible.
		for (let i = 0; i < 20 && !(await again.evaluate((el) => el === document.activeElement)); i++) {
			await page.keyboard.press('Tab');
		}
		await expect(again).toBeFocused();
		const outline = await again.evaluate((el) => getComputedStyle(el).outlineStyle);
		expect(outline).not.toBe('none');
	});
});
