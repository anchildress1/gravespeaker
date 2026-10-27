# Gravespeaker Constitution

`CLAUDE.md` holds the full engineering rules and `docs/PRD.md` holds scope. This file lists only the gates `/speckit-plan` must pass. On conflict, `CLAUDE.md` wins.

## Core Principles

### I. Deadline-Bound MVP Scope

- Build only what the MVP journey in `docs/PRD.md` §2 requires. Hard deadline: 2026-10-31 23:59 PDT.
- PRD §10 (v2) and §6 Stretch items are out of scope for every MVP spec.
- Every feature ships as a vertical slice that leaves `main` deployable.

### II. Never Fabricate History (NON-NEGOTIABLE)

- Every narrative claim maps to a source record with a URL.
- Unsupported fields render as unknown.
- No credible record → the app says so; it never fills the gap.

### III. Never Merge Identities Silently (NON-NEGOTIABLE)

- More than one plausible match → return candidates; the user picks one or none.

### IV. Two Seams Only

- Abstractions exist only for **model inference** (`src/lib/server/inference/`) and **historical search** (`src/lib/server/search/`).
- One interface and one implementation each. Everything else is concrete.
- A plan that adds another interface, config layer, cache, retry, queue, or feature flag fails this gate.

### V. Behavior-Driven Tests

- Cover positive, negative, error, and edge scenarios for functional logic listed in `CLAUDE.md` § Tests.
- Mock only at the network boundary (Gemini API, SerpApi).
- Coverage target 80%, never a build gate.

## Privacy and Source Constraints

- Uploaded images are processed in memory and never stored.
- API keys stay server-side; the browser never calls a provider.
- Link to sources; never republish their content.
- Omit unnecessary details about living people.

## Development Workflow

- One feature per branch; spec-kit setup changes never ride on a feature branch.
- `make ai-checks` passes before a task is marked complete.
- Lefthook is never bypassed.

## Governance

- Amend this file only when `CLAUDE.md` or `docs/PRD.md` changes a gate.
- Bump MAJOR for a removed or redefined principle, MINOR for an added one, PATCH for wording.

**Version**: 1.0.0 | **Ratified**: 2026-10-27 | **Last Amended**: 2026-10-27
