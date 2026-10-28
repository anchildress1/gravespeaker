---
description: 'Task list for the Gravespeaker MVP journey'
---

# Tasks: Gravespeaker MVP Journey

**Input**: `specs/001-mvp-journey/` — plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Required. `CLAUDE.md` § Tests mandates behavior tests for parsing, identity, grounding, input validation and provider errors. Mock only at the network boundary: stub `globalThis.fetch` for Gemini (`generativelanguage.googleapis.com`) and SerpApi (`serpapi.com`). Never hit live APIs in tests.

**Every task**: JSDoc on every function, method and class; inline comments only for _why_. Done = `make ai-checks` passes with zero warnings.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[Story]**: US1 read the stone · US2 find and confirm · US3 tell the story

---

## Phase 1: Setup

- [x] T001 (user-approved 2026-10-27) Add exact-pinned runtime deps with `pnpm add --save-exact @mastra/core zod @mozilla/readability linkedom robots-parser undici` in `package.json`. If pnpm's release-age gate rejects a version, pin the previous release; never add `minimumReleaseAgeExclude` (research R11).
- [x] T002 [P] (user-approved 2026-10-27) Raise `BODY_SIZE_LIMIT=10M` to `BODY_SIZE_LIMIT=12M` in `Dockerfile` (research R10).

---

## Phase 2: Foundational

**⚠️ Blocks every story.**

- [x] T003 [P] Create shared client/server types in `src/lib/types.ts`: `PartialDate` (string matching `^[0-9?]{4}(-[0-9?]{2}-[0-9?]{2})?$`), `Inscription { carvedName; name; maidenName: string | null; born: PartialDate | null; died: PartialDate | null }`, `SourceRecord { id; url; title; site; snippet }`, `Candidate { name; born; died; confidence: 'high' | 'medium' | 'low'; sources: SourceRecord[] }`, `Story = { status: 'told'; paragraph: string; sources } | { status: 'insufficient' }`, `ApiError { error: { code: 'invalid_input' | 'unsupported_type' | 'too_large' | 'provider_failed'; message } }`.
- [x] T004 [P] Create `src/lib/server/env.ts` exporting `geminiApiKey()` and `serpApiKey()` read from `$env/dynamic/private` (`GEMINI_API_KEY`, `SERPAPI_API_KEY`); throw a clear error when empty.
- [x] T005 [P] Create `src/lib/server/http.ts`: `apiError(code, message, status)` returning a SvelteKit `json()` response in the `ApiError` shape, and `ProviderError` class thrown by both seams after Mastra retries are exhausted; endpoints map `ProviderError` → 502 `provider_failed`.
- [x] T006 [P] Create the inference seam interface in `src/lib/server/inference/index.ts`: `InferenceProvider { readStone(image: Uint8Array, mimeType: string): Promise<RawPerson[]>; extractFacts(inscription: Inscription, candidate: Candidate, pages: PageText[]): Promise<RawFact[]>; tellStory(name: string, facts: string[]): Promise<string> }` with raw (pre-validation) types `RawPerson { name; born; died }`, `RawFact { claim: 'name' | 'birth' | 'death' | 'other'; sourceId: string; quote: string }`, `PageText { sourceId; text }`. One interface only.
- [x] T007 [P] Create the search seam interface in `src/lib/server/search/index.ts`: `SearchProvider { search(query: string): Promise<SourceRecord[]> }`.
- [x] T008 Create `src/lib/server/inference/gemma.ts` exporting `class GemmaProvider implements InferenceProvider` (methods filled per story) with one private factory building a Mastra `Agent` using `model: { id: 'google/gemma-4-26b-a4b-it', apiKey: geminiApiKey() }` and Mastra `maxRetries` (research R3). Wrap a final provider failure in `ProviderError`. Export a module-level `inference` instance.

**Checkpoint**: seams and shared types exist.

---

## Phase 3: User Story 1 — Read the stone (P1) 🎯 MVP

**Goal**: Photo → read-only name and life dates.

**Independent Test**: Upload each reviewed fixture; displayed fields match `fixtures/manifest.json` (quickstart § Extraction accuracy).

### Tests (write first, see them fail)

- [x] T009 [P] [US1] `src/lib/server/inscription.test.ts`: `"[]"` and `"[?]"` names → person dropped; `"Gaynor Claire Hawks née Staples"` → `name "Gaynor Claire Hawks"`, `maidenName "Staples"`; `"nee"` without accent handled; `"Mr Andrew Morgan"` → honorific dropped; `"18?8"` kept; `"1932-03-10"` kept; `"March 1941"` → `null`; `"19"` → `null`; non-English letters (`"Ødegård"`) kept; empty array stays empty.
- [x] T010 [P] [US1] `src/routes/api/read/server.test.ts`: `text/plain` upload → 415 `unsupported_type`; 11 MB jpeg → 413 `too_large`; missing `image` field → 400 `invalid_input`; stubbed Gemini reply for Hawks → 200 normalized person; stubbed Gemini reply wrapped in a ` ```json ` fence → still parsed (research R4 risk); stubbed Gemini 503 on every attempt → 502 `provider_failed`; reply `{"people":[{"name":"[]",…}]}` → `{ people: [] }`.

### Implementation

- [x] T011 [US1] Implement `normalizeInscriptions(raw: RawPerson[]): Inscription[]` in `src/lib/server/inscription.ts`: drop names with no `\p{L}`; strip honorifics `Mr|Mrs|Miss|Dr` (case-insensitive, optional `.`); split `\b(née|nee)\s+(\S+)` into `maidenName`; collapse whitespace; keep `carvedName` as read; use `import type` for anything from `#lib/types` so plain Node (`benchmarks/run.ts`) can load this module with type stripping; dates must match `^[0-9?]{4}(-[0-9?]{2}-[0-9?]{2})?$` else `null`.
- [x] T012 [US1] Implement `GemmaProvider.readStone` in `src/lib/server/inference/gemma.ts`. App code owns the prompt; never import from `benchmarks/` (excluded from the Docker build context). Rewrite run 9's rules as one instructions string in the app: transcribe only what is carved; one entry per person the stone is for; relatives named in relation and nicknames are not people; dates `YYYY-MM-DD` or `YYYY`; `?` for an unreadable or ambiguous digit; `null` when absent; non-life-date years excluded. Keep every rule, cut repetition. One Zod `readSchema` (`{ people: { name, born, died }[] }` with `.describe()` hints) is the only schema definition. User parts = image (`mimeType`) + `"Transcribe the gravestone in this photo."`; `temperature: 0, topP: 0.95, topK: 64`; Mastra `structuredOutput: { schema: readSchema }`. If T010's fenced-reply case fails, add a Mastra output processor — no hand parser.
- [x] T013 [US1] Implement `POST` in `src/routes/api/read/+server.ts`: read `image` from `formData()`; accept only `image/jpeg|png|webp|heic|heif`; reject > 10 MB (`10 * 1024 * 1024`); bytes stay in memory; return `{ people: normalizeInscriptions(await inference.readStone(...)) }`.
- [x] T014 [US1] Build capture + read UI in `src/routes/+page.svelte` (Svelte 5 runes, mobile-first): `<input type="file" accept="image/*" capture="environment">`, states `Capture → Reading → (PickPerson | fields shown | no legible name)` per data-model state diagram; files over 10 MB rejected in the browser before upload; a non-JSON 413 from the server shows the too-large message; fields read-only; unknown dates rendered as "unknown" and `?` digits shown as-is; 2+ people → list to pick one (FR-012); "no legible name" offers retry; errors show `message` with retry.
- [x] T015 [US1] Playwright e2e in `src/routes/journey.e2e.ts` with `page.route('/api/read', …)` mocks: single person shows read-only fields; `{ people: [] }` shows "no legible name" with retry; two people shows a picker. Run at a 390 px viewport.
- [x] T016 [US1] Extraction accuracy run: write `benchmarks/prompts/run10.json` as a snapshot of the shipped prompt (the app's instructions string, user text, sampling, and `z.toJSONSchema(readSchema)` output) so run 10 measures the rewrite, not run 9; make `benchmarks/run.ts` record both `got` (raw reply, as in runs 1–9) and `normalized` (`normalizeInscriptions(got.people)`, including `maidenName`); make `benchmarks/score.ts` score `normalized` when present and `got` otherwise, and state in the doc that run 10 onward scores normalized output; run `node benchmarks/run.ts benchmarks/prompts/run10.json benchmarks/results/run10-hosted-26b.json gemma-4-26b-a4b-it`; score with `benchmarks/score.ts`. Expected ≥ 57/58 fields (only Ellis 1818 → 1848 may miss), illegible fixture → no people, median < 6 s (SC-001–003). Append a "Run 10" section to `docs/benchmarks/ocr-smoke-test.md`. Never overwrite earlier runs. `fixtures/holmquist-2024.jpg` stays local-only; `benchmarks/run.ts` skips a manifest entry whose photo is missing.

**Checkpoint**: US1 deployable alone.

---

## Phase 4: User Story 2 — Find and confirm the person (P2)

**Goal**: Inscription → candidate people with sources → visitor picks one or none.

**Independent Test**: With stubbed SerpApi replies, candidates show source links; "none of these" ends on the stone-only epitaph, never an AI story.

### Tests (write first)

- [x] T017 [P] [US2] `src/lib/server/identity.test.ts`:
  - `buildQuery`: full dates → `"Name" 1932 2017 (obituary OR grave OR cemetery)`; `18?8` year omitted.
  - `dropGated`: `ancestry.com`, `www.newspapers.com`, `search.findmypast.co.uk` removed; `legacy.com`, `findagrave.com` kept.
  - `resolveMatches(inscription, records)`: right person with death date missing returned (medium); name plus both years high; age-derived birth; conflicting year excluded; namesake excluded while the real match is kept; different given name excluded; whole-word surname; maiden name; suffix (Jr/Sr/II-V); accents; `?` wildcard (`18?8` matches `1818` and `1848`); name-only low; record-like ranking; far-away years ignored; cap 5 sources; nothing matched → no candidate.
- [x] T018 [P] [US2] `src/lib/server/search/serpapi.test.ts`: several engines merged in engine order into `SourceRecord[]` with ids `s1…sN`, `site` = hostname; URL dedupe incl. Find a Grave locales and slugs; one engine failing tolerated; every engine failing → `ProviderError`; no results → `[]`; non-http link skipped.
- [x] T019 [P] [US2] `src/routes/api/research/server.test.ts`: invalid body → 400; stubbed search with zero results → 200 `{ candidates: [] }`; stubbed search results → candidate per contract; SerpApi failing every attempt → 502 `provider_failed`.

- [x] T020 [P] [US2] `src/lib/epitaph.test.ts`: Hawks (`1932-03-10`/`2017-12-27`, today `2026-10-31`) → exactly "My name was Gaynor Claire Hawks. I was born on March 10, 1932. I died on December 27, 2017. I've been here 8 years."; year-only `born "1932"` → "I was born in 1932."; `died "18?8"` → no death or years sentence; `born null` → no birth sentence; died 2026-06-01 → "less than a year"; died 2025-10-31 → "I've been here 1 year."

### Implementation

- [x] T021 [P] [US2] Implement `epitaph(inscription: Inscription, today: Date): string[]` in `src/lib/epitaph.ts` per data-model § Epitaph. Pure; no model; `today` injected for tests; month names in English.
- [x] T022 [P] [US2] Implement `class SerpApiProvider implements SearchProvider` in `src/lib/server/search/serpapi.ts` calling `https://serpapi.com/search.json` with plain `fetch` for engines `google`, `yandex` in parallel (`api_key`; Google adds `num=10`, `gl=us`, `hl=en`). Merge in that order, dedupe by canonical URL. One engine failing is tolerated; all failing → `ProviderError`. The `serpapi` package is not used: it relies on node `https`, which tests cannot mock. Export a module-level `search` instance.
- [x] T023 [P] [US2] Implement `buildQuery`, `dropGated` (deny-list `ancestry.*`, `newspapers.com`, `genealogybank.com`, `myheritage.*`, `findmypast.*`, `newspaperarchive.com`, `fold3.com` — match on registrable domain), and `resolveMatches(inscription, records)` (deterministic, no model) in `src/lib/server/identity.ts` per research R7.
- [x] T024 [US2] Removed: `GemmaProvider.pickMatches` no longer exists; matching is the deterministic engine in `identity.ts` (research R7).
- [x] T025 [US2] Create the research workflow in `src/lib/server/research.ts`: Mastra `createWorkflow` with steps `search` (`createStep({ retries: 2 })`: `buildQuery` → `search.search` → `dropGated`), `resolve` (`resolveMatches`). Export `runResearch(inscription): Promise<Candidate[]>`; failed run → `ProviderError`.
- [x] T026 [US2] Implement `POST` in `src/routes/api/research/+server.ts`: validate body as `Inscription` with Zod (same `PartialDate` regex); return `{ candidates }`.
- [x] T027 [US2] Extend `src/routes/+page.svelte`: `Researching → Confirm | Epitaph`. Each candidate shows name, life dates when known, the confidence (low reads "Unverified: only the name matches. Check the sources before confirming."), and source links (`target="_blank" rel="noopener noreferrer"`). Always require explicit confirmation, even for one candidate (FR-011). "None of these" and `{ candidates: [] }` → stone-only epitaph (`epitaph(inscription, new Date())`) with the matching note from data-model § Epitaph, sourced to "the headstone", no AI label, plus "Try another photo" (FR-010, FR-019, FR-023). An `ApiError` or network failure shows its `message` with a retry that re-sends the same inscription.
- [x] T028 [US2] Extend `src/routes/journey.e2e.ts`: mocked `/api/research` with one candidate still requires a tap to confirm; "none of these" shows the Hawks epitaph sentences and "No public record was confirmed" with no AI label; `{ candidates: [] }` shows the epitaph with "No public records were found"; a 502 `provider_failed` shows the message and retry succeeds on the next mocked response.

**Checkpoint**: US1 + US2 work end to end without a story.

---

## Phase 5: User Story 3 — Hear their story (P3)

**Goal**: Confirmed candidate → grounded first-person story built from verified facts, with its sources listed.

**Independent Test**: Every fact a story from stubbed sources uses traces to a verbatim quote in one of that candidate's sources (SC-004).

### Tests (write first)

- [x] T029 [P] [US3] `src/lib/server/pages.test.ts` (stub `fetch` and DNS lookup): `http://169.254.169.254/`, `http://localhost/`, `http://10.0.0.5/`, `http://[::1]/`, `ftp://x` rejected without fetching; multicast, reserved, benchmarking, documentation, NAT64, 6to4 and Teredo addresses rejected; public URL redirecting to `127.0.0.1` rejected; malformed redirect target → unavailable; > 3 redirects rejected; robots.txt `Disallow: /` for `Gravespeaker` → skipped; robots.txt unreachable or 5xx → skipped, 4xx → no rules; robots.txt checked on each redirect hop; 403 → skipped; body failing mid-read → unavailable; body > 2 MB truncated or skipped; HTML obituary → readable main text extracted.
- [x] T030 [P] [US3] `src/lib/server/narrative.test.ts`: fact citing an id not in `candidate.sources` dropped; fact whose `quote` is absent from the cited source's text dropped; quote match ignores case, punctuation and whitespace; repeated fact dropped; fact whose quote names survivors ("survived by", "survivors", "leaves behind") dropped; only `name`/`birth`/`death`/date-only facts survive → `insufficient`; paragraph sentence adding a number or number word, a proper noun or a negation no verified fact gives dropped; repeated sentence dropped; paragraph no longer using a real fact → `insufficient`; output `sources` contains only sources of facts the paragraph uses; facts and quotes absent from output.
- [x] T031 [P] [US3] `src/routes/api/story/server.test.ts`: invalid body → 400; stubbed pages + Gemini facts and paragraph → `told` per contract with no fact/quote/page text in the response; stubbed Gemini returning only date facts → `insufficient` and the prose call is skipped; Gemini failing every attempt → 502; non-provider failure → 500.

### Implementation

- [x] T032 [P] [US3] Implement `fetchPage(url): Promise<string | null>` in `src/lib/server/pages.ts` per research R8–R9: `http(s)` only; resolve DNS once per hop via `node:dns/promises` `lookup(host, { all: true })` and reject loopback, private, link-local, CGNAT, ULA, unspecified, multicast, reserved, benchmarking and documentation IPv4 ranges, and IPv6 multicast, NAT64, 6to4 and Teredo; pin the connection to the checked address with an `undici` dispatcher; `redirect: 'manual'`, ≤ 3 hops, re-check each hop; `AbortSignal.timeout(8000)`; stop reading after 2 MB; `robots-parser` for UA `Gravespeaker` checked at every hop (once per origin), unreachable/5xx/unreadable robots.txt → skip, 4xx → no rules; send `User-Agent: Gravespeaker` on every request; 401/402/403, non-HTML, a body failing mid-read or a malformed redirect target → `null`; extract with `@mozilla/readability` over `linkedom` `parseHTML`. Never throws. Never persist.
- [x] T033 [P] [US3] Implement `verifyFacts`, `hasEvidence` and `groundParagraph` in `src/lib/server/narrative.ts` per research R8: keep a fact only if its quote appears verbatim (normalized) in the cited source and it does not name survivors; the evidence bar counts a fact only if its quote has a token outside the name tokens, month names and digits; drop prose sentences that add a number, proper noun or negation the verified facts do not give.
- [x] T034 [US3] Implement `GemmaProvider.extractFacts` and `GemmaProvider.tellStory` in `src/lib/server/inference/gemma.ts`. `extractFacts`: temperature 0; return `{ claim, sourceId, quote }` facts with short verbatim quotes; never invent relationships, events, memories, thoughts or emotions; name a relative only when a cited source says they died before the deceased; never name survivors or other living people (FR-017). `tellStory(name, facts)`: temperature 1.0, top_p 0.95, top_k 64; one theatrical first-person paragraph of about 100-170 words, plain spoken prose with no stage directions or markup (a voice service will read it aloud), written from the verified fact quotes only.
- [x] T035 [US3] Create the story workflow in `src/lib/server/story.ts`: steps `fetch` (no retries, ≤ 5 pages in parallel via `fetchPage`, fallback to `snippet` per source), `facts` (`inference.extractFacts` then `verifyFacts`; `insufficient` skips the next step), `tell` (`inference.tellStory`), `ground` (`groundParagraph`). Export `runStory(inscription, candidate): Promise<Story>`.
- [x] T036 [US3] Implement `POST` in `src/routes/api/story/+server.ts`: Zod-validate `{ inscription, candidate }` (`candidate.sources` length ≥ 1, `url` `http(s)` only); return `runStory(...)`.
- [x] T037 [US3] Extend `src/routes/+page.svelte`: `Telling → Story | Epitaph`. Visible "Story generated with AI" label; the paragraph and the sources used listed below it; `insufficient` → stone-only epitaph with "The records hold nothing beyond the stone" and restart (FR-023). An `ApiError` or network failure shows its `message` with a retry that re-sends the same confirmed candidate.
- [x] T038 [US3] Extend `src/routes/journey.e2e.ts`: mocked `told` story shows the AI label, the paragraph and a working link on every listed source; mocked `insufficient` shows the epitaph with "The records hold nothing beyond the stone" and no AI label; a 502 `provider_failed` shows the message and retry succeeds on the next mocked response.

**Checkpoint**: full journey works.

---

## Phase 6: Polish

- [x] T039 Run Semgrep and Sonar scans on the branch; fix findings (SSRF guard and upload handling are the hot spots).
- [x] T040 Run quickstart manual phone + desktop walkthroughs, timing photo → story on the phone (SC-006: < 2 min excluding read time); Lighthouse only via chrome-devtools MCP `lighthouse_audit` against `pnpm preview`.
- [x] T041 Update `README.md` via the `readme-generator` skill (journey, setup, `.env` keys).

---

## Dependencies

- Setup (T001–T002) → Foundational (T003–T008) → US1 → US2 → US3 → Polish.
- US2 needs US1's `Inscription` and normalization; US3 needs US2's `Candidate`. Stories are sequential slices; each leaves `main` deployable.
- Within a story: tests → pure modules → seam method → workflow → endpoint → UI → e2e.

## Parallel Examples

- **Foundational**: T003, T004, T005, T006, T007 together; T008 after T004–T006.
- **US1**: T009 + T010 together; then T011 → T012 → T013; T014 after T013.
- **US2**: T017 + T018 + T019 + T020 together; T021 + T022 + T023 together; then T024 → T025 → T026 → T027 → T028.
- **US3**: T029 + T030 + T031 together; T032 + T033 together; then T034 → T035 → T036 → T037 → T038.

## Implementation Strategy

1. **MVP = US1** (T001–T016): deploy photo → fields; measure run 10 against SC-001–003. Matches the PRD Wed Oct 28 milestone.
2. **US2** (Thu Oct 29): research + confirm; deploy.
3. **US3** (Fri Oct 30): story + citations; deploy the public end-to-end demo.
4. **Polish** before Sat Oct 31 submission. The grounding benchmark (Gemma vs Flash) is the next spec.
