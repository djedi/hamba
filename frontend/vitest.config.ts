import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	plugins: [svelte({ hot: !process.env.VITEST })],
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts'],
		globals: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			reportsDirectory: './coverage',
			include: ['src/lib/**/*.ts'],
			exclude: ['src/lib/**/*.test.ts']
		},
		setupFiles: ['./vitest.setup.ts']
	},
	resolve: {
		alias: {
			$lib: '/src/lib'
		}
	}
});
