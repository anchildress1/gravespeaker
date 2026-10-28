# HTTP Contract: Gravespeaker MVP

Three same-origin JSON endpoints. The browser calls only these; providers are server-side (FR-021). Entity shapes: [data-model.md](../data-model.md).

All errors: `{ "error": { "code": string, "message": string } }`, `message` safe to show the visitor.

| Code               | HTTP | When                                                                |
| ------------------ | ---- | ------------------------------------------------------------------- |
| `invalid_input`    | 400  | Body fails validation                                               |
| `unsupported_type` | 415  | Upload is not an accepted image type                                |
| `too_large`        | 413  | Upload > 10 MB                                                      |
| `provider_failed`  | 502  | Model failed after Mastra retries, or search failed on every engine |

Only a `ProviderError` becomes a 502. Any other workflow failure is a 500.

## POST `/api/read`

Request: `multipart/form-data`, field `image` (jpeg/png/webp/heic/heif, ≤ 10 MB). Image bytes stay in memory for the request only.

Response 200:

```json
{
	"people": [
		{
			"carvedName": "Gaynor Claire Hawks née Staples",
			"name": "Gaynor Claire Hawks",
			"maidenName": "Staples",
			"born": "1932-03-10",
			"died": "2017-12-27"
		}
	]
}
```

- `people: []` → no legible name (illegible stone, non-headstone photo).
- 2+ entries → client asks the visitor to pick one.

## POST `/api/research`

Request: one `Inscription` (as returned by `/api/read`).

Response 200:

```json
{
	"candidates": [
		{
			"name": "Gaynor Claire Hawks",
			"born": "1932-03-10",
			"died": "2017-12-27",
			"confidence": "medium",
			"sources": [{ "id": "s1", "url": "https://…", "title": "…", "site": "…", "snippet": "…" }]
		}
	]
}
```

- `candidates` has 0 to 3 entries: usually one; more only when records for different people both fit the stone. `[]` → no record found; client shows the Epitaph.
- `confidence` is `high`, `medium` or `low`; the client shows it. `low` means only the name matches and reads "Unverified: only the name matches. Check the sources before confirming."
- Gated domains already removed; every source matches the stone on name and none states a conflicting year. `sources` has 1-5 entries.

## POST `/api/story`

Request: `{ "inscription": Inscription, "candidate": Candidate }` — the candidate the visitor confirmed.

- Every `candidate.sources[].url` passes the SSRF guard (research R9) before fetch; failing URLs fall back to the snippet. Fetching has no retries.

Response 200, one of:

```json
{ "status": "told", "paragraph": "I was born on March 10, 1932. …", "sources": [ … ] }
```

```json
{ "status": "insufficient" }
```

- `insufficient` → client shows the Epitaph (data-model.md).

- `sources` lists only the sources of facts the paragraph uses.
- Facts, quotes and claims never appear in the response.
- Fetched page text never appears in the response.
