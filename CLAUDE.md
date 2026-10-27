MVP proof of concept. Hard deadline: 2026-10-31 23:59 PDT. Ship the smallest thing that satisfies `docs/PRD.md`.

## Output

- The user designs; you implement. Report only what the user must act on or must know changed in the repo.
- Per change: file and one-line effect. No narration of steps, tools, or reasoning.
- Surface blockers, decisions needed, and failures in full. Omit everything else.

## Scope

- Build only what the MVP journey in `docs/PRD.md` requires. Anything outside it: stop and ask.
- No feature flags, plugin systems, config layers, caching, retries, queues, or i18n unless a broken user path demands it.
- Exception: model and search calls use Mastra's built-in retry and error handling. Never hand-roll retries.
- Model output passes through a deterministic layer that parses names and normalizes dates. Never trust the model's formatting.
- Non-English inscriptions are not optimized for. Never add code that rejects them either.
- Prefer a framework/library capability over hand-rolled code.
- Delete dead code. Never keep a path "just in case". No backward-compat shims.
- Exactly two abstraction seams exist: **model inference** and **historical search**. One interface each, one implementation each until a second is actually needed. Concrete classes everywhere else.

## Design

- Follow SOLID, KISS, YAGNI at all times. When they conflict, KISS and YAGNI win.
- One responsibility per module. No god files, no `utils` dumping grounds.
- Never fabricate history. Every narrative claim maps to a source record; unsupported fields render as unknown, not guessed.
- Never merge records from different people silently. Ambiguous identity → return candidates for user confirmation.

## Tests

- Coverage goal: 80%. It's a target, not a gate. Never add thresholds that fail the build on coverage.
- For functional logic, cover every scenario that is likely or has already happened: positive, negative, error, edge.
- Functional logic: inscription parsing, identity matching, claim-to-source mapping, input validation, narrative grounding, provider error handling.
- Every test asserts behavior a caller depends on. Coverage comes from that, never the other way around.
- Below 80%: add missing scenarios for real logic. Never pad.
- Banned: tests of constants, type shapes, getters, framework wiring, rendering-only snapshots, mocks asserting they were called.
- Mock at the network boundary (Gemini API, SerpApi). Never hit live APIs in tests.
- Bug fix → one test that fails before the fix.

## Comments and JSDoc

- Inline comments: only to explain **why** a decision was made. Otherwise omit.
- JSDoc is required on every function, method, and class — exported or not.
- `eslint-plugin-jsdoc` enforces this. Named arrow functions count; inline callbacks do not.
- JSDoc format: one-line summary, `@param`, `@returns`, `@throws` when applicable. Do not restate types TypeScript already declares.

```ts
/**
 * Scores how likely a search hit refers to the person on the headstone.
 * @param inscription Fields extracted from the headstone image.
 * @param hit Candidate record from historical search.
 * @returns Confidence in [0, 1].
 */
```

## Toolchain

- Node **26.12.1** exactly. Earlier 26.x releases carry the CVEs fixed in the 2026-10-21 security release. Pin the same version in `package.json` (`engines`, `volta`), the Dockerfile, and CI. Never lower it.
- TypeScript `strict`. ESM only. No CommonJS.
- pnpm **11.28.9** only. Never npm or yarn. Never pnpm 12: it ships as a native binary that Volta can't launch.
- Never add `minimumReleaseAgeExclude` entries. If pnpm rejects a too-new release, pin the previous version.
- TypeScript stays on 6.0.x until typescript-eslint, svelte-check, and `@sveltejs/kit` support 7.
- Validation gate before reporting any change as done: `make ai-checks`.

## Layout

- One SvelteKit app. Server-only code lives in `src/lib/server/` and never reaches the client bundle.
- Provider seams: `src/lib/server/inference/` and `src/lib/server/search/`.
- Benchmark: `benchmarks/run.ts` runs a prompt file from `benchmarks/prompts/`; `benchmarks/score.ts` scores it. Fixture images: `fixtures/`, ground truth in `fixtures/manifest.json`.
- Save every benchmark run as new files: `benchmarks/prompts/runN.json` and `benchmarks/results/runN-<model>.json`. Never overwrite an earlier run.
- Fixtures never depict notable people (anyone with a Wikipedia article). Models already know them, which inflates OCR and grounding scores. Same-name namesakes are allowed and noted as identity traps.
- Keep the fixture set small. Recent graves (death 2010+) are the baseline. Historic stones are a minority that stress-test reading, never the norm.
- Ground truth is unverified until the user reviews it (`reviewed: true`). Never publish benchmark numbers from unreviewed fixtures.
- Deploy: `deploy.sh` → one Cloud Run service in GCP project `anchildress1`. API keys come from Secret Manager, never env files in the image.
- Lint, type, and test warnings are errors.
- Secrets live in `.env` only (gitignored). `.env.example` lists keys with empty values.

## Secrets

- Secret Manager bills per secret. Create one only when prod cannot run without it. Ask before adding any.
- Name every secret `GRAVESPEAKER_<KEY>` in project `anchildress1`. Never reuse another app's secret, including the bare shared ones (`GEMINI_API_KEY`).
- Map secret to env var in `deploy.sh`: `GEMINI_API_KEY=GRAVESPEAKER_GEMINI_API_KEY:latest`. App code reads the generic name.
- Prod secrets: `GRAVESPEAKER_GEMINI_API_KEY`, `GRAVESPEAKER_SERPAPI_API_KEY`. Runtime identity: `gravespeaker-run@anchildress1.iam.gserviceaccount.com`.
- Never print secret values. Pipe from `.env` into `gcloud secrets create --data-file=-`.

## Repo workflow

- Never bypass Lefthook on commit or push: no `--no-verify`, no `LEFTHOOK=0`, no skipped commands. A failing hook means fix the cause, or stop and report the exact failure to the user.
- Never merge a release-please PR. Leave it open until the user explicitly says to merge it.
- Pin every GitHub Action, `actions/*` included, to a full commit SHA with the version in a trailing comment. Resolve with `gh api` at write time.
- Lighthouse runs only through the chrome-devtools MCP `lighthouse_audit` tool against `pnpm preview`. Never add `@lhci/cli` or `lighthouse` to the repo in any form (`devDependencies`, `pnpm dlx`, CI, hooks): their dependency tree carries unpatched advisories.
- Edit `README.md` only through the `readme-generator` skill.
