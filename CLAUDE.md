MVP proof of concept. Hard deadline: 2026-10-31 23:59 PDT. Ship the smallest thing that satisfies `docs/PRD.md`.

## Scope

- Build only what the MVP journey in `docs/PRD.md` requires. Anything outside it: stop and ask.
- No feature flags, plugin systems, config layers, caching, retries, queues, or i18n unless a broken user path demands it.
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
- Benchmark script: `scripts/benchmark.ts`. Fixture images: `fixtures/`.
- Deploy: `deploy.sh` → one Cloud Run service. API keys come from Secret Manager, never env files in the image.
- Lint, type, and test warnings are errors.
- Secrets live in `.env` only (gitignored). `.env.example` lists keys with empty values.
