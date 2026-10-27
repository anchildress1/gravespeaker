# 🪦 Gravespeaker

<!-- Banner image: add one at static/banner.png and uncomment below -->
<!-- ![Banner](./static/banner.png) -->

[![CI](https://github.com/anchildress1/gravespeaker/actions/workflows/ci.yml/badge.svg)](https://github.com/anchildress1/gravespeaker/actions/workflows/ci.yml) [![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=anchildress1_gravespeaker&metric=alert_status)](https://sonarcloud.io/project/overview?id=anchildress1_gravespeaker) [![License: Polyform Shield](https://img.shields.io/badge/license-Polyform%20Shield-blue)](LICENSE)

Photograph a headstone. Discover a life. Hear the story the records left behind.

- [About](#about)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Deploying](#deploying)
- [Security](#security)
- [License](#license)
- [Author](#author)

---

## About

Gravespeaker is a mobile-friendly web app. Upload or snap a photo of a gravestone, confirm what the AI read from the stone, and get a short first-person story built only from public records you can click through and check.

If the records can't establish who the person was, the app says so instead of making something up. Every claim is either cited or clearly marked as AI reconstruction.

Built for Hacktoberfest 2026, Week 4: Ghost in the Machine. The [PRD](docs/PRD.md) has the full scope, schedule and definition of done.

---

## Tech Stack

| Layer              | Choice                                          |
| ------------------ | ----------------------------------------------- |
| App                | SvelteKit (Svelte 5, Vite 8), `adapter-node`    |
| Runtime            | Node.js 26.12.1, TypeScript 6 (strict), pnpm 11 |
| AI orchestration   | Mastra                                          |
| Vision and stories | Gemma 4 via the Gemini API                      |
| Record search      | SerpApi                                         |
| Hosting            | Google Cloud Run, Secret Manager                |
| Quality            | Vitest, Playwright, ESLint, SonarCloud, CodeQL  |

---

## Getting Started

You need:

- [Volta](https://volta.sh) with pnpm support switched on. Volta reads the pinned Node and pnpm versions from `package.json`.
- `actionlint` and `gitleaks`, which the git hooks call.

```bash
export VOLTA_FEATURE_PNPM=1          # add to your shell profile
brew install actionlint gitleaks

make install                          # dependencies + Lefthook git hooks
cp .env.example .env                  # then fill in the keys
make dev
```

### Commands

| Command            | What it does                                                  |
| ------------------ | ------------------------------------------------------------- |
| `make dev`         | Start the dev server                                          |
| `make ai-checks`   | Format check, lint, typecheck, unit tests and build in one go |
| `make test`        | Unit tests with coverage                                      |
| `make e2e`         | Playwright tests on a mobile viewport                         |
| `make perf`        | Lighthouse, on demand only (fetched with `pnpm dlx`)          |
| `make secret-scan` | gitleaks over the working tree                                |
| `make deploy`      | Ship to Cloud Run                                             |
| `make clean`       | Remove build output                                           |

The Lefthook hooks run format, lint, actionlint and gitleaks on every commit; commitlint on every commit message; and typecheck, unit and e2e tests before every push.

---

## Configuration

| Variable          | Used for                           |
| ----------------- | ---------------------------------- |
| `GEMINI_API_KEY`  | Gemma 4 vision and narrative calls |
| `SERPAPI_API_KEY` | Public-record search               |

Locally, these go in `.env`, which is gitignored. In production, Cloud Run injects them from Secret Manager (see [Deploying](#deploying)).

---

## Deploying

Production runs as one Cloud Run service in the `anchildress1` GCP project:

- **Runtime identity:** the `gravespeaker-run` service account.
- **Secrets:** namespaced per app and mapped to the variables above.

| Secret Manager name            | Env var           |
| ------------------------------ | ----------------- |
| `GRAVESPEAKER_GEMINI_API_KEY`  | `GEMINI_API_KEY`  |
| `GRAVESPEAKER_SERPAPI_API_KEY` | `SERPAPI_API_KEY` |

The service account and the Gemini secret already exist. Add the SerpApi secret once, piping it from `.env` so the value never hits your terminal history:

```bash
grep '^SERPAPI_API_KEY=' .env | cut -d= -f2- | tr -d '\n' \
  | gcloud secrets create GRAVESPEAKER_SERPAPI_API_KEY --project anchildress1 --data-file=-
gcloud secrets add-iam-policy-binding GRAVESPEAKER_SERPAPI_API_KEY --project anchildress1 \
  --member serviceAccount:gravespeaker-run@anchildress1.iam.gserviceaccount.com \
  --role roles/secretmanager.secretAccessor
```

After that, `make deploy` builds the image with Cloud Build and deploys it.

---

## Security

- API keys stay on the server. The browser never talks to Gemini or SerpApi directly.
- Uploaded photos are processed in memory and never stored.
- Secrets are never shared between apps in the GCP project. Secret Manager bills per secret, so add one only when production can't run without it.
- Every GitHub Action is pinned to a commit SHA, and Dependabot proposes updates after a 7-day cooldown.
- gitleaks runs locally before every commit and again in CI.

---

## License

Released under the [Polyform Shield License 1.0.0](LICENSE). It's source-available, not open source, so read the license before you build a paid SaaS on top of it.

- **You can:** use it, fork it, learn from it, run it at your day job, hand it to a client.
- **You can't:** sell it, rebrand it, host it as a paid SaaS, or otherwise make money from it without explicit written permission.
- **Public forks:** include the LICENSE file and credit the original work.

---

## Author

Ashley Childress · [@anchildress1](https://github.com/anchildress1)
