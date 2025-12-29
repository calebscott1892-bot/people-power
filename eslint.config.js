import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,

      // App uses the React 17+ JSX transform + function components without prop-types.
      'react/prop-types': 'off',

      // Many shadcn/radix components use custom attributes; don't block builds on this.
      'react/no-unknown-property': 'off',

      // Keep hooks rules strict (real runtime issues), but reduce general noise.
      'no-unused-vars': ['warn', { varsIgnorePattern: '^React$', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'react/no-unescaped-entities': 'warn',

      'react/jsx-no-target-blank': 'off',
      // This repo includes many shadcn/ui helper exports in component files.
      // The rule is noisy and doesn't indicate runtime issues here.
      'react-refresh/only-export-components': 'off',
    },
  },

  // Node/CommonJS config files
  {
    files: ['vite.config.js', 'tailwind.config.js', 'postcss.config.js', 'eslint.config.js', 'Server/**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'off',
    },
  },
]
