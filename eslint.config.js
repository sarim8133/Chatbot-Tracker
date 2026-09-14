import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build output, plus every directory an AI tool keeps its own scripts in. Those
  // are third-party code we don't own and can't fix, and before they were ignored
  // `npm run lint` reported 250 problems, 238 of which were theirs — which is the
  // same as reporting nothing. `.claude/worktrees` is a checkout of THIS repo, so
  // without it every source file gets linted twice.
  globalIgnores([
    'dist',
    '.agents/**',
    '.claude/**',
    '.codex/**',
    '.gemini/**',
    '.impeccable/**',
    '.superpowers/**',
    'graphify-out/**',
    // Bodies of n8n Code nodes, kept here so a change can be reviewed in git. They
    // are pasted INTO a function in n8n, so a top-level `return` is correct there
    // and a parse error here — there is no way to lint them as written.
    'n8n/**',
  ]),
  {
    // Config files run in Node, not the browser, so `process` is not an undefined
    // global in them.
    files: ['*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
