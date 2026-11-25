// ESLint for the whole repo: one flat config, run from the root with `pnpm lint`.
// Type-aware (typescript-eslint reads each app's tsconfig), so it catches things the compiler
// allows but are almost always bugs, like a promise nobody waits for or handles.
// apps/server/src/lintRules.test.ts checks the money and key rules below against sample code.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// ---- Money: every paid AI call goes through paidCall (CLAUDE.md rule 3) ----
//
// The only files allowed to talk to an AI service. Each one sends its paid calls through `paidCall`
// (apps/server/src/cost.ts), which checks the daily caps before the call and logs the cost after
// it, and hands out only those calls, never a client. Anything else reaching a provider could make
// calls the caps never see. This is a guard-rail against mistakes, not a wall: code review still
// matters (eslint-disable for these rules is refused by lintRules.test.ts).
const AI_WRAPPERS = ['apps/server/src/describeSketch.ts', 'apps/server/src/generateImage.ts', 'apps/server/src/moderation.ts'];
const ONLY_WRAPPERS = 'Only the AI wrappers (describeSketch.ts, generateImage.ts, moderation.ts) may reach an AI service, so every paid call goes through paidCall.';

// AI SDKs and clients: ours, and the usual others, so a new one is a deliberate change here.
const AI_PACKAGES = ['@anthropic-ai/sdk', 'openai', 'ai', '@google/genai', '@google/generative-ai', 'replicate', 'cohere-ai', 'groq-sdk'];
const AI_PACKAGE_GROUPS = ['@anthropic-ai/*', '@openai/*', '@ai-sdk/*', '@mistralai/*', ...AI_PACKAGES.map((name) => `${name}/*`)];
// The wrappers' raw-client helpers (exported for their own tests): they make calls without paidCall.
// Matched however the path is written (./describeSketch, ./describeSketch.js, ../describeSketch).
const RAW_CLIENTS = [
  { regex: '(^|/)describeSketch(\\.[cm]?[jt]s)?$', importNames: ['anthropicBriefClient'] },
  { regex: '(^|/)generateImage(\\.[cm]?[jt]s)?$', importNames: ['openAiImageClient'] },
  { regex: '(^|/)moderation(\\.[cm]?[jt]s)?$', importNames: ['openAiModerationClient'] },
];
const noAiImports = {
  paths: AI_PACKAGES.map((name) => ({ name, message: ONLY_WRAPPERS })),
  patterns: [{ group: AI_PACKAGE_GROUPS, message: ONLY_WRAPPERS }, ...RAW_CLIENTS.map((pattern) => ({ ...pattern, message: ONLY_WRAPPERS }))],
};
// What the import rule can't see: other ways to load a package, and calling a provider directly.
const AI_SOURCE = '/^(openai|ai|replicate|cohere-ai|groq-sdk|@anthropic-ai.|@openai.|@ai-sdk.|@google.gen|@mistralai.)/';
const PROVIDER_HOST = '/api[.](openai|anthropic)[.]com/i';
const noAiLoading = [
  `ImportExpression[source.value=${AI_SOURCE}]`,
  // import(`openai`), import(name): a computed module name can't be checked, so it isn't allowed.
  "ImportExpression[source.type!='Literal']",
  `CallExpression[callee.name='require'][arguments.0.value=${AI_SOURCE}]`,
  "CallExpression[callee.object.name='module'][callee.property.name='require']",
  "Identifier[name='createRequire']",
  // fetch('https://api.openai.com/…') needs no import at all.
  `Literal[value=${PROVIDER_HOST}]`,
  `TemplateElement[value.raw=${PROVIDER_HOST}]`,
].map((selector) => ({ selector, message: ONLY_WRAPPERS }));

// ---- Keys stay on the server (CLAUDE.md rule 1) ----
//
// Vite copies every VITE_* variable that web code reads into the public bundle. A key-like name is
// refused, and import.meta.env may only be read one name at a time (`import.meta.env.VITE_WS_URL`),
// so destructuring it or passing the whole object around can't slip a key past the name check.
const KEY_LIKE = '/KEY|SECRET|TOKEN|PASSWORD|PRIVATE/i';
const KEYS_ON_SERVER = 'Keys stay on the server (CLAUDE.md rule 1): a VITE_ variable read here ships to every browser.';
const noViteKey = [
  `MemberExpression[object.object.type='MetaProperty'][object.property.name='env'][property.name=${KEY_LIKE}]`,
  `MemberExpression[object.object.type='MetaProperty'][object.property.name='env'][property.value=${KEY_LIKE}]`,
  // import.meta.env used as a whole: destructured, assigned, spread, passed, Object.values(...).
  "MemberExpression[object.type='MetaProperty'][property.name='env']:not(MemberExpression > MemberExpression.object)",
  // import.meta['env'], import.meta.env[name]: a computed name can't be checked.
  "MemberExpression[object.type='MetaProperty'][computed=true]",
  "MemberExpression[computed=true][object.object.type='MetaProperty'][object.property.name='env'][property.type!='Literal']",
  // const meta = import.meta; meta.env.VITE_...: import.meta may only be read one property at a time.
  "MetaProperty[meta.name='import']:not(MemberExpression > MetaProperty.object)",
].map((selector) => ({ selector, message: KEYS_ON_SERVER }));

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'apps/server/data/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // `_name` marks something unused on purpose (a destructured field we drop, a callback argument).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // `void promise` is how this repo says "not awaited, on purpose" (with a comment why).
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // CLAUDE.md rule 5: no `any` without a comment saying why (an eslint-disable line is that comment).
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      // The typescript-eslint version also covers `import type` and `import x = require()`.
      '@typescript-eslint/no-restricted-imports': ['error', noAiImports],
      'no-restricted-syntax': ['error', ...noAiLoading],
    },
  },

  // Plain JavaScript config files (this one, the pnpm hook) aren't in any tsconfig.
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // Node code: the server, and the web app's build scripts.
  {
    files: ['apps/server/**/*.ts', 'apps/web/scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  // The AI wrappers and their tests may use the SDKs and call the providers.
  {
    files: [...AI_WRAPPERS, ...AI_WRAPPERS.map((file) => file.replace(/\.ts$/, '.test.ts'))],
    rules: { '@typescript-eslint/no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },

  // The web app (what ships to the browser): browser globals, React.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    // Repeats the shared list: a rule set here replaces the earlier one instead of adding to it.
    rules: { 'no-restricted-syntax': ['error', ...noAiLoading, ...noViteKey] },
  },

  // Tests: mocks and fixtures are loosely typed on purpose.
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      // Some tests throw a string or another non-Error on purpose, to check it's handled.
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
    },
  },
);
