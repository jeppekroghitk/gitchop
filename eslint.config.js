import js from '@eslint/js';
import globals from 'globals';

/**
 * ESLint's recommended rules over every script, each directory given the globals of the place its
 * code actually runs — so a reach for `document` from the background, or for `chrome` from a
 * build script, is caught here rather than in a browser.
 */
export default [
  {
    // What the build and the bundler write: a store reviewer reads these, but they are src/ joined up.
    ignores: ['dist/', 'dev/content.js'],
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  // The content script, the settings page and the welcome: a page, with the extension APIs beside it.
  {
    files: ['src/content/**/*.js', 'src/options/**/*.js', 'src/welcome/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },

  // The background is a service worker in Chrome, so it is held to what one has, even though
  // Firefox runs it as an event page with a window. src/lib is imported by the background as well
  // as by the page-side code, so it is held to the same.
  {
    files: ['src/background/**/*.js', 'src/lib/**/*.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.webextensions },
    },
  },

  // The build, the dev server and the tests run under node.
  {
    files: ['dev/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      globals: { ...globals.node },
    },
  },
];
