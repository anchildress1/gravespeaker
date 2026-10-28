# Implementation Plan: Gravespeaker MVP Journey

**Branch**: `feat/mvp-journey` | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-mvp-journey/spec.md`

## Summary

One SvelteKit page drives the journey photo → read → research → confirm → story. The page talks to three stateless JSON endpoints.

- Hosted Gemma 4 26B, called through Mastra Agents, reads the stone with run 9's rules, rewritten as app-owned instructions and re-measured as run 10.
- SerpApi finds records.
- Gemma groups the results into candidates.
- After the visitor confirms a candidate, the server fetches that candidate's source pages in memory and Gemma writes a first-person story.
- Deterministic code owns the format and the grounding at every step:
  - name and date normalization;
  - identity merge and conflict rules;
  - citation and quote checks;
  - the evidence bar.

## Technical Context

**Language/Version**: TypeScript 6.0.x (strict, ESM) on Node 26.12.1

**Primary Dependencies**:

- Already in the repo: SvelteKit 3 with adapter-node, Svelte 5 runes.
- New:
  - `@mastra/core` (Agents, `createWorkflow`/`createStep`)
  - `zod` 4
  - `serpapi`
  - `@mozilla/readability`
  - `linkedom`
  - `robots-parser`

**Storage**: None. Images, fetched page text and journey state never persist.

**Testing**: Vitest unit tests with mocks at the Gemini and SerpApi boundaries, plus Playwright e2e on the page with mocked endpoints.

**Target Platform**: One Cloud Run service (Linux container). Mobile Safari, Chrome Android and desktop browsers.

**Project Type**: Web app, one SvelteKit project with UI and server endpoints.

**Performance Goals**: Median under 6 s from photo to fields (SC-003). Research and story each under about 20 s, bounded by the free-tier queue.

**Constraints**:

- Free Gemini API tier only.
- Upload limit 10 MB, with adapter-node `BODY_SIZE_LIMIT=12M`.
- Page fetch: 8 s timeout, 2 MB cap, 5 pages at most.

**Scale/Scope**: Demo traffic. 1 page, 3 endpoints, and 12 server modules.

## Constitution Check

_Gate re-checked after Phase 1: **PASS**._

| Gate                      | Status | Evidence                                                                                                                                                                                                                |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Deadline-bound scope   | ✅     | Only PRD §2 steps. Voice, field editing and companion-stone tuning are excluded. The grounding benchmark is deferred to the next spec (R12).                                                                            |
| II. Never fabricate       | ✅     | Each fact needs a valid `sourceId` and a quote found in that source (R8). The `insufficient`, none and no-record paths end on a code-built stone-only epitaph (FR-023), never a model. Unknown dates render as unknown. |
| III. Never merge silently | ✅     | A source claimed by two candidates is removed from both. The visitor always confirms, even a single match (R7).                                                                                                         |
| IV. Two seams only        | ✅     | `InferenceProvider` (Gemma via Mastra) and `SearchProvider` (SerpApi), one implementation each. No cache, queue, flag or config layer. Retries are Mastra's.                                                            |
| V. Behavior-driven tests  | ✅     | The scenario table in [quickstart.md](quickstart.md) covers parsing, identity, grounding, validation and provider errors. Mocks sit only at Gemini and SerpApi.                                                         |
| Privacy                   | ✅     | Images stay in memory. Keys stay server-side. Page text is never returned. Survivors are never named, only their relationship. Predeceased relatives may be named with a citation (FR-017).                             |
| Workflow                  | ✅     | One feature branch. `make ai-checks` is the gate.                                                                                                                                                                       |

## Project Structure

### Documentation (this feature)

```text
specs/001-mvp-journey/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
src/
├── routes/
│   ├── +page.svelte                 # journey state machine (data-model.md)
│   └── api/
│       ├── read/+server.ts          # upload checks → inference.readStone → inscription
│       ├── research/+server.ts      # research workflow
│       └── story/+server.ts         # story workflow
└── lib/
    ├── types.ts                     # Inscription, Candidate, SourceRecord, Story (shared with client)
    ├── epitaph.ts                   # stone-only epitaph from an Inscription (client)
    └── server/
        ├── env.ts                   # GEMINI_API_KEY, SERPAPI_API_KEY via $env/dynamic/private
        ├── inference/
        │   ├── index.ts             # InferenceProvider interface
        │   └── gemma.ts             # Mastra Agents: read, group, tell
        ├── search/
        │   ├── index.ts             # SearchProvider interface
        │   └── serpapi.ts
        ├── inscription.ts           # name/date normalization (R4)
        ├── identity.ts              # query build, gated filter, candidate rules (R5–R7)
        ├── pages.ts                 # SSRF-guarded fetch, robots, readability (R8–R9)
        ├── narrative.ts             # citation + quote validation, evidence bar (R8)
        ├── research.ts              # Mastra workflow: search (retries) → group → identity
        └── story.ts                 # Mastra workflow: fetch pages (retries) → tell → narrative
```

Tests sit next to each module as `*.test.ts`. The e2e test goes in `src/routes/journey.e2e.ts`, matching the repo Playwright `testMatch` (`**/*.e2e.ts`).

**Structure Decision**: Keep the single SvelteKit project already in the repo. Server code lives in `src/lib/server/` per CLAUDE.md § Layout, and the two seam directories match the constitution.

## Deployment Notes

- Dockerfile: raise `BODY_SIZE_LIMIT` from `10M` to `12M`, so a 10 MB photo plus multipart overhead reaches the app's own 413 check. This edits repo config and is approved by this plan.
- `deploy.sh`: no change. It already maps `GRAVESPEAKER_GEMINI_API_KEY` and `GRAVESPEAKER_SERPAPI_API_KEY`.
- No new secrets.

## Complexity Tracking

No violations.
