import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { photoLocation } from './photo-location';

// A 1×1 JPEG whose only metadata is GPS 44.0521 N, 123.0868 W.
const tagged = new Uint8Array(await readFile(new URL('./testdata/gps.jpg', import.meta.url)));

describe('photoLocation', () => {
	it('reads signed coordinates from EXIF GPS', () => {
		const at = photoLocation(tagged);
		expect(at?.lat).toBeCloseTo(44.0521, 4);
		expect(at?.lon).toBeCloseTo(-123.0868, 4);
	});

	it('returns null for a photo without GPS', async () => {
		const plain = new Uint8Array(
			await readFile(new URL('../../../fixtures/chambers-2011.jpg', import.meta.url))
		);
		expect(photoLocation(plain)).toBeNull();
	});

	it('returns null for bytes that are not an image', () => {
		expect(photoLocation(new Uint8Array([1, 2, 3]))).toBeNull();
	});
});
