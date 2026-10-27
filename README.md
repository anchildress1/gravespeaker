# 🪦 Gravespeaker

<!-- Banner image: add one at static/banner.png and uncomment below -->
<!-- ![Banner](./static/banner.png) -->

[![CI](https://github.com/anchildress1/gravespeaker/actions/workflows/ci.yml/badge.svg)](https://github.com/anchildress1/gravespeaker/actions/workflows/ci.yml)
[![License: Polyform Shield](https://img.shields.io/badge/license-Polyform%20Shield-blue)](LICENSE)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=anchildress1_gravespeaker&metric=alert_status)](https://sonarcloud.io/project/overview?id=anchildress1_gravespeaker)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=anchildress1_gravespeaker&metric=coverage)](https://sonarcloud.io/project/overview?id=anchildress1_gravespeaker)

Photograph a headstone. Discover a life. Hear the story the records left behind. See [the PRD](docs/PRD.md) for the full picture.

## Setup

You need [Volta](https://volta.sh) with its pnpm support switched on (`VOLTA_FEATURE_PNPM=1`). Volta reads the pinned Node and pnpm versions from `package.json`.

The git hooks also call `actionlint` and `gitleaks`, which aren't npm packages:

```bash
brew install actionlint gitleaks
```

`make install` installs dependencies and the Lefthook git hooks.

```bash
make install
cp .env.example .env   # then fill in the keys
make dev
```

## Available Commands

| Command             | Description                                                 |
| ------------------- | ----------------------------------------------------------- |
| `make install`      | Install dependencies                                        |
| `make dev`          | Start the dev server                                        |
| `make format`       | Format code                                                 |
| `make format-check` | Check formatting                                            |
| `make lint`         | Run the linter                                              |
| `make typecheck`    | Svelte and TypeScript type check                            |
| `make test`         | Unit tests with coverage                                    |
| `make build`        | Production build                                            |
| `make e2e`          | Playwright E2E tests (mobile viewport)                      |
| `make perf`         | Lighthouse, run locally only                                |
| `make secret-scan`  | Scan for secrets with gitleaks                              |
| `make ai-checks`    | Run format-check, lint, typecheck, test and build in one go |
| `make deploy`       | Deploy to Cloud Run                                         |
| `make clean`        | Remove build artifacts                                      |

## Deploying

Before the first deploy, run this once in the target GCP project:

```bash
PROJECT_ID=$(gcloud config get-value project)
gcloud iam service-accounts create gravespeaker --project "$PROJECT_ID"
for s in gemini-api-key serpapi-api-key; do
  gcloud secrets create "$s" --project "$PROJECT_ID" --data-file=-   # paste the key, then Ctrl-D
  gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT_ID" \
    --member "serviceAccount:gravespeaker@$PROJECT_ID.iam.gserviceaccount.com" \
    --role roles/secretmanager.secretAccessor
done
```

After that, `make deploy` builds the container with Cloud Build and ships it to Cloud Run.

## License

Released under the [Polyform Shield License 1.0.0](LICENSE). It's source-available, not open source, so read the license before you build a paid SaaS on top of it.

- **You can:** use it, fork it, learn from it, run it at your day job, hand it to a client.
- **You can't:** sell it, rebrand it, host it as a paid SaaS, or otherwise make money from it without explicit written permission.
- **Public forks:** include the LICENSE file and credit the original work.
