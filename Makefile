# Without this, Volta runs pnpm on the Node it was installed with instead of the pinned one.
export VOLTA_FEATURE_PNPM := 1

.PHONY: install dev format format-check lint typecheck test eval eval-research build e2e secret-scan clean ai-checks deploy

install:
	@echo "📦 Installing dependencies..."
	pnpm install --frozen-lockfile

dev:
	@echo "🚀 Starting development server..."
	pnpm dev

format:
	@echo "✨ Formatting code..."
	pnpm format

format-check:
	@echo "✨ Checking formatting..."
	pnpm format:check

lint:
	@echo "🔍 Linting code..."
	pnpm lint

typecheck:
	@echo "🔎 Type checking..."
	pnpm check

test:
	@echo "🧪 Running unit tests..."
	pnpm test

eval:
	@echo "👻 Running live story evals..."
	pnpm eval benchmarks/evals/

eval-research:
	@echo "🔎 Replaying research from saved searches (writes a new research-N.json)..."
	FIXTURES=people pnpm eval benchmarks/research.eval.ts

build:
	@echo "🏗️ Building project..."
	pnpm build

e2e:
	@echo "🎭 Running E2E tests..."
	pnpm test:e2e

secret-scan:
	@if command -v gitleaks > /dev/null; then \
		gitleaks dir .; \
	else \
		echo "❌ gitleaks not found. Install: https://github.com/gitleaks/gitleaks#installing"; \
		exit 1; \
	fi

clean:
	@echo "🧹 Cleaning up..."
	rm -rf node_modules build .svelte-kit coverage playwright-report test-results

ai-checks: format-check lint typecheck test build

deploy:
	./deploy.sh
