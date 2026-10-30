// The browser waits on an unanswered permission prompt forever, so the read gives up after this.
const PATIENCE_MS = 8000;

/**
 * Asks the browser where the visitor stands, which is usually the cemetery.
 * @returns Latitude and longitude, or null when denied, unavailable or too slow.
 */
export function locate(): Promise<{ lat: number; lon: number } | null> {
	if (!('geolocation' in navigator)) return Promise.resolve(null);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), PATIENCE_MS);
		/**
		 * Settles the lookup once.
		 * @param at The position, or null.
		 */
		const done = (at: { lat: number; lon: number } | null) => {
			clearTimeout(timer);
			resolve(at);
		};
		navigator.geolocation.getCurrentPosition(
			(p) => done({ lat: p.coords.latitude, lon: p.coords.longitude }),
			() => done(null),
			// A town is all the search needs, so a coarse or ten-minute-old fix will do.
			{ enableHighAccuracy: false, maximumAge: 600_000, timeout: PATIENCE_MS }
		);
	});
}
