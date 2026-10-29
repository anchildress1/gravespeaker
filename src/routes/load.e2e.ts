import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

// Google's "good" Core Web Vitals thresholds: https://web.dev/articles/vitals
const BUDGET = { FCP: 1800, LCP: 2500, CLS: 0.1 };

// A mid-range phone on a slow mobile network, roughly Lighthouse's mobile profile.
const SLOW_4G = {
	offline: false,
	latency: 150,
	downloadThroughput: (1.6 * 1024 * 1024) / 8,
	uploadThroughput: (750 * 1024) / 8
};
const CPU_SLOWDOWN = 4;

// The package's require entry is its UMD build, which a classic script exposes as `webVitals`.
const vitalsScript = createRequire(import.meta.url).resolve('web-vitals');

test('the invitation loads within the Core Web Vitals budget on a slow phone', async ({ page }) => {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Network.enable');
	await cdp.send('Network.emulateNetworkConditions', SLOW_4G);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

	await page.addInitScript({ path: vitalsScript });
	await page.addInitScript(() => {
		const seen: Record<string, number> = {};
		Object.assign(window, { vitals: seen });
		/**
		 * Keeps the latest value of each metric.
		 * @param metric One web-vitals report.
		 * @param metric.name Metric name.
		 * @param metric.value Metric value.
		 */
		const keep = ({ name, value }: { name: string; value: number }): void => {
			seen[name] = value;
		};
		const { onFCP, onLCP, onCLS } = (
			window as unknown as { webVitals: typeof import('web-vitals') }
		).webVitals;
		onFCP(keep);
		onLCP(keep, { reportAllChanges: true });
		onCLS(keep, { reportAllChanges: true });
	});

	await page.goto('/', { waitUntil: 'networkidle' });
	await expect(page.getByText('Photograph a headstone')).toBeVisible();
	// CLS and LCP settle once the page is hidden; switching tabs is how a visitor finalizes them.
	await page.evaluate(() => {
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
	});

	const vitals = await page.evaluate(
		() => (window as unknown as { vitals: Record<string, number> }).vitals
	);
	console.log('web vitals', vitals);
	expect(vitals.FCP).toBeLessThanOrEqual(BUDGET.FCP);
	expect(vitals.LCP).toBeLessThanOrEqual(BUDGET.LCP);
	expect(vitals.CLS ?? 0).toBeLessThanOrEqual(BUDGET.CLS);
});
