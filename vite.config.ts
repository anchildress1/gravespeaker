import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Runes everywhere except dependencies, which may still ship legacy components.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					include: [
						'src/**/*.{test,spec}.ts',
						'scripts/**/*.{test,spec}.ts',
						'benchmarks/**/*.test.ts'
					]
				}
			},
			// Live model calls and recorded searches: never part of `pnpm test` or CI.
			{ extends: true, test: { name: 'eval', include: ['benchmarks/**/*.eval.ts'] } }
		],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov'],
			include: ['src/**/*.ts', 'scripts/**/*.ts', 'benchmarks/evals/**/*.ts'],
			// Tests, Playwright specs, ambient types and SvelteKit's env declaration hold no app logic.
			exclude: [
				'**/*.test.ts',
				'**/*.spec.ts',
				'**/*.e2e.ts',
				'**/*.eval.ts',
				'src/app.d.ts',
				'src/env.ts'
			]
		}
	}
});
