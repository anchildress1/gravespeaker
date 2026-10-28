# HTTP Contract: Gravespeaker MVP

Three same-origin JSON endpoints. The browser calls only these; providers are server-side (FR-021). Entity shapes: [data-model.md](../data-model.md).

All errors: `{ "error": { "code": string, "message": string } }`, `message` safe to show the visitor.

| Code               | HTTP | When                                        |
| ------------------ | ---- | ------------------------------------------- |
| `invalid_input`    | 400  | Body fails validation                       |
| `unsupported_type` | 415  | Upload is not an accepted image type        |
| `too_large`        | 413  | Upload > 10 MB                              |
| `provider_failed`  | 502  | Model or search failed after Mastra retries |

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
			"place": null,
			"sources": [{ "id": "s1", "url": "https://…", "title": "…", "site": "…", "snippet": "…" }]
		}
	]
}
```

- `candidates: []` → no record found; client shows the Epitaph.
- Gated domains already removed; no source appears in two candidates.

## POST `/api/story`

Request: `{ "inscription": Inscription, "candidate": Candidate }` — the candidate the visitor confirmed.

- Every `candidate.sources[].url` passes the SSRF guard (research R9) before fetch; failing URLs fall back to the snippet.

Response 200, one of:

```json
{ "status": "told", "sentences": [{ "text": "I was born on March 10, 1932.", "kind": "fact", "sourceIds": ["s1"] }, { "text": "The stone remembers me still.", "kind": "reconstruction", "sourceIds": [] }], "sources": [ … ] }
```

```json
{ "status": "insufficient" }
```

- `insufficient` → client shows the Epitaph (data-model.md).

- `quote` and `claim` never appear in the response.
- Fetched page text never appears in the response.
