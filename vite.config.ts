import { defineConfig } from 'vitest/config'
import dts from 'vite-plugin-dts'

export default defineConfig(({ mode }) => {
  if (mode === 'client') {
    return {
      // Vite replaces import.meta.hot with undefined in library builds; this
      // define keeps the expression itself in dist/client.js so the consumer's
      // own dev server can inject its HMR context when it transforms the file.
      define: { 'import.meta.hot': 'import.meta.hot' },
      build: {
        lib: {
          entry: 'src/client/index.ts',
          formats: ['es'],
          fileName: () => 'client.js',
        },
        emptyOutDir: false,
        minify: false,
        target: 'es2022',
      },
    }
  }

  return {
    plugins: [
      dts({
        include: ['src'],
        exclude: ['src/client/**', 'src/__tests__/**'],
        bundleTypes: true,
        tsconfigPath: './tsconfig.json',
        processor: 'ts',
      }),
    ],
    build: {
      lib: {
        entry: 'src/index.ts',
        formats: ['es'],
        fileName: () => 'index.js',
      },
      rolldownOptions: {
        external: [/^node:/, 'vite'],
      },
      minify: false,
      target: 'node20',
    },
    test: {
      include: ['src/__tests__/**/*.spec.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        exclude: ['src/__tests__/**'],
        reporter: ['text', 'json-summary'],
      },
    },
  }
})
