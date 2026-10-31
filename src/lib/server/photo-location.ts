import ExifReader from 'exifreader';

/** A point on the map, in decimal degrees. */
export interface Coordinates {
	lat: number;
	lon: number;
}

/**
 * Reads where a photo was taken from its EXIF GPS tags.
 * @param image Image bytes as uploaded.
 * @returns The coordinates, or null when the photo carries none or cannot be parsed.
 */
export function photoLocation(image: Uint8Array): Coordinates | null {
	try {
		// Only the Exif block is parsed, so XMP, ICC and maker notes in an untrusted upload are skipped.
		const { gps } = ExifReader.load(image, {
			expanded: true,
			includeTags: { exif: true, gps: true }
		});
		const lat = gps?.Latitude;
		const lon = gps?.Longitude;
		return lat === undefined || lon === undefined ? null : { lat, lon };
	} catch {
		return null;
	}
}
