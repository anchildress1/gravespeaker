import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testMatch: '**/*.e2e.ts',
	testIgnore: '**/.worktrees/**',
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? 'html' : 'list',
	use: { baseURL: 'http://localhost:4173' },
	projects: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
	webServer: { command: 'pnpm build && pnpm preview', port: 4173 }
});
