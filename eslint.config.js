import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dist-demo', 'coverage', 'node_modules', 'test-results', 'playwright-report', 'bench/results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
)
