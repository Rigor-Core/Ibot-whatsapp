import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        sessionStorage: 'readonly',
        EventSource: 'readonly',
        AbortController: 'readonly',
        Blob: 'readonly',
        Intl: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        confirm: 'readonly',
        decodeURIComponent: 'readonly',
        encodeURIComponent: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        performance: 'readonly',
        Buffer: 'readonly',
        structuredClone: 'readonly',
        '$': 'readonly',
        IbotApi: 'readonly',
        escapeHtml: 'readonly',
        toast: 'readonly',
        loadUserBot: 'readonly',
        bindPanelLogout: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_|^req$|^res$|^next$' }],
      'no-empty': 'warn',
    }
  }
];
