import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	{ ignores: ['**/CHANGELOG.md', 'coverage/', 'playwright-report/', '.worktrees/'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint recommends disabling no-undef on TS projects; tsc already catches it.
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		files: ['**/*.{ts,svelte}'],
		...jsdoc.configs['flat/recommended-typescript-error'],
		rules: {
			...jsdoc.configs['flat/recommended-typescript-error'].rules,
			'jsdoc/require-jsdoc': [
				'error',
				{
					publicOnly: false,
					require: {
						FunctionDeclaration: true,
						MethodDefinition: true,
						ClassDeclaration: true,
						FunctionExpression: false,
						ArrowFunctionExpression: false
					},
					// Named arrow functions need JSDoc; inline callbacks do not.
					contexts: ['VariableDeclarator > ArrowFunctionExpression']
				}
			]
		}
	}
);
