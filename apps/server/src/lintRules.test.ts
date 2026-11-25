import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// The lint rules that guard money and keys (eslint.config.js), checked with the real config. A test,
// so that loosening the config by mistake (a typo in a file list, a rule turned off for everyone)
// fails like any other broken rule.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: ROOT });

// The first lint builds the TypeScript program for the whole repo: about a second here, several on
// CI's slower machines, past Vitest's 5 s default. Do it once up front with its own long limit, so
// no single test pays for it, and give each test some room on a slow machine.
vi.setConfig({ testTimeout: 30_000 });
beforeAll(async () => {
  await eslint.lintFiles(['apps/server/src/picture.test.ts', 'apps/web/src/lib/jobs.test.ts']);
}, 120_000);

// Lints `code` as if it were the file at `file`, and returns which rules complained.
async function rulesHit(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}${file}` });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse error');
}

// Samples are linted under the names of test files: they must be real files in a tsconfig, and
// nothing imports a test file, so the made-up code can't change how other files type-check in
// this run (linting it as picture.ts would make index.ts, which imports it, look broken). The rules
// checked here apply to tests the same as to source.
const SERVER_FILE = 'apps/server/src/picture.test.ts';
const WEB_FILE = 'apps/web/src/lib/jobs.test.ts';

describe('only the AI wrappers may use an AI SDK', () => {
  it.each([
    ['a default import', "import Anthropic from '@anthropic-ai/sdk';\nexport const a = Anthropic;\n"],
    ['a named import of a subpath', "import { toFile } from 'openai/uploads';\nexport const t = toFile;\n"],
    ['a type-only import', "import type { ImagesResponse } from 'openai/resources';\nexport type A = ImagesResponse;\n"],
    ['a re-export', "export { default } from 'openai';\n"],
  ])('flags %s in another server file', async (_label, code) => {
    expect(await rulesHit(SERVER_FILE, code)).toContain('@typescript-eslint/no-restricted-imports');
  });

  it.each([
    ['a dynamic import', "export async function f(): Promise<unknown> {\n  return (await import('openai')).default;\n}\n"],
    ['a dynamic import of the Anthropic SDK', "export async function f(): Promise<unknown> {\n  return import('@anthropic-ai/sdk');\n}\n"],
  ])('flags %s in another server file', async (_label, code) => {
    expect(await rulesHit(SERVER_FILE, code)).toContain('no-restricted-syntax');
  });

  it.each(['@anthropic-ai/bedrock-sdk', '@anthropic-ai/claude-agent-sdk', '@openai/agents', 'ai', '@ai-sdk/openai', '@google/genai', 'replicate'])(
    'flags another AI package, %s',
    async (name) => {
      expect(await rulesHit(SERVER_FILE, `import * as m from '${name}';\nexport const x = m;\n`)).toContain('@typescript-eslint/no-restricted-imports');
    },
  );

  it.each([
    ['anthropicBriefClient', './describeSketch'],
    ['openAiImageClient', './generateImage'],
    ['openAiModerationClient', './moderation'],
    ['anthropicBriefClient', './describeSketch.js'],
    ['openAiImageClient', '../src/generateImage'],
  ])("flags importing the raw client helper %s, which calls without paidCall", async (name, from) => {
    expect(await rulesHit(SERVER_FILE, `import { ${name} } from '${from}';\nexport const c = ${name};\n`)).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('allows the paid entry points the server uses', async () => {
    const code = "import { createDescribeSketchForKey } from './describeSketch';\nimport { createPictureCallsForKey } from './generateImage';\nexport const a = [createDescribeSketchForKey, createPictureCallsForKey];\n";
    expect(await rulesHit(SERVER_FILE, code)).toEqual([]);
  });

  // Built at run time, so this file itself doesn't contain a provider address (which the rule refuses).
  const OPENAI = ['api', 'openai', 'com'].join('.');
  const ANTHROPIC = ['api', 'anthropic', 'com'].join('.');
  it.each([
    ['a fetch to OpenAI', `export const r = fetch('https://${OPENAI}/v1/images/generations');\n`],
    ['a fetch to Anthropic in a template', `const v = 1;\nexport const r = fetch(\`https://${ANTHROPIC}/v\${v}/messages\`);\n`],
    ['a template dynamic import', 'export const m = import(`openai`);\n'],
    ['a computed dynamic import', "const name = 'open' + 'ai';\nexport const m = import(name);\n"],
    ['createRequire', "import { createRequire } from 'node:module';\nexport const r = createRequire(import.meta.url);\n"],
  ])('flags %s in another server file', async (_label, code) => {
    expect(await rulesHit(SERVER_FILE, code)).toContain('no-restricted-syntax');
  });

  it('flags an SDK import in the web app', async () => {
    expect(await rulesHit(WEB_FILE, "import OpenAI from 'openai';\nexport const o = OpenAI;\n")).toContain('@typescript-eslint/no-restricted-imports');
  });

  it.each(['apps/server/src/describeSketch.ts', 'apps/server/src/generateImage.ts', 'apps/server/src/moderation.ts', 'apps/server/src/index.ts'])(
    'passes %s as it is',
    async (file) => {
      expect(await rulesHit(file, await readFile(`${ROOT}${file}`, 'utf8'))).toEqual([]);
    },
  );
});

describe('keys stay out of the web app', () => {
  it.each([
    ['a dotted read', 'export const k: unknown = import.meta.env.VITE_OPENAI_API_KEY;\n'],
    ['a bracket read', "export const k: unknown = import.meta.env['VITE_SECRET'];\n"],
    ['a token', 'export const k: unknown = import.meta.env.VITE_AUTH_TOKEN;\n'],
  ])('flags %s of a key-like VITE_ variable', async (_label, code) => {
    expect(await rulesHit(WEB_FILE, code)).toContain('no-restricted-syntax');
  });

  it.each([
    ['destructuring', 'const { VITE_WS_URL } = import.meta.env;\nexport const u = VITE_WS_URL;\n'],
    ['keeping the whole object', 'const env = import.meta.env;\nexport const u: unknown = env.VITE_WS_URL;\n'],
    ['listing every value', 'export const all = Object.values(import.meta.env);\n'],
    ['a computed env', "export const u: unknown = import.meta['env'].VITE_WS_URL;\n"],
    ['a computed name', "const name = 'VITE_WS_URL';\nexport const u: unknown = import.meta.env[name];\n"],
    ['an alias for import.meta', 'const meta = import.meta;\nexport const u: unknown = meta.env.VITE_WS_URL;\n'],
  ])('flags import.meta.env used as a whole (%s), which could carry a key past the name check', async (_label, code) => {
    expect(await rulesHit(WEB_FILE, code)).toContain('no-restricted-syntax');
  });

  it('allows an ordinary VITE_ setting', async () => {
    expect(await rulesHit(WEB_FILE, 'export const url = import.meta.env.VITE_WS_URL;\n')).toEqual([]);
  });
});

describe('promises are handled', () => {
  it('flags a promise nobody waits for or handles', async () => {
    const code = 'async function work(): Promise<void> {}\nexport function f(): void {\n  work();\n}\n';
    expect(await rulesHit(SERVER_FILE, code)).toContain('@typescript-eslint/no-floating-promises');
  });

  it('accepts `void` as "not awaited, on purpose"', async () => {
    const code = 'async function work(): Promise<void> {}\nexport function f(): void {\n  void work();\n}\n';
    expect(await rulesHit(SERVER_FILE, code)).toEqual([]);
  });
});

describe('the rules can not be switched off from inside a file', () => {
  // ESLint lets a comment turn a rule off. For these rules that would undo the point, so no source
  // file may do it, and no file may turn ESLint off as a whole.
  const GUARDED = /(no-restricted-imports|no-restricted-syntax)/;
  const DISABLE = /eslint-disable(?:-next-line|-line)?([^\n*]*)/g;
  // The other inline form: /* eslint no-restricted-syntax: "off" */ sets a rule from inside a file.
  const INLINE_CONFIG = /\/\*\s*eslint\s+([^*]*)\*\//g;

  // The comments in `text` that would switch the money or key rules off.
  function switchOffs(text: string): string[] {
    const found: string[] = [];
    for (const match of text.matchAll(DISABLE)) {
      const rules = (match[1] ?? '').split('--')[0]?.trim() ?? '';
      if (rules === '' || GUARDED.test(rules)) found.push(match[0].trim());
    }
    for (const match of text.matchAll(INLINE_CONFIG)) {
      if (GUARDED.test(match[1] ?? '')) found.push(match[0].trim());
    }
    return found;
  }

  async function sourceFiles(): Promise<string[]> {
    const out: string[] = [];
    for (const dir of ['apps/server/src', 'apps/web/src']) {
      for (const entry of await readdir(`${ROOT}${dir}`, { withFileTypes: true, recursive: true })) {
        if (entry.isFile() && /\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) out.push(`${entry.parentPath}/${entry.name}`);
      }
    }
    return out;
  }

  it('finds no eslint-disable for the money and key rules, and no blanket disable', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      if (file.endsWith('lintRules.test.ts')) continue; // this file names the pattern it looks for
      for (const comment of switchOffs(await readFile(file, 'utf8'))) offenders.push(`${file.slice(ROOT.length)}: ${comment}`);
    }
    expect(offenders).toEqual([]);
  });

  it('is a check that can fail: it spots every kind in sample text, and leaves other rules alone', () => {
    const sample = [
      '// eslint-disable-next-line @typescript-eslint/no-restricted-imports',
      '/* eslint-disable */',
      'const a = 1; // eslint-disable-line no-restricted-syntax',
      '/* eslint no-restricted-syntax: 0 */',
      '/* eslint @typescript-eslint/no-restricted-imports: "off" */',
      '// eslint-disable-next-line react-hooks/set-state-in-effect -- a reason',
      '/* eslint eqeqeq: "off" */',
    ].join('\n');
    expect(switchOffs(sample)).toHaveLength(5);
  });
});

describe('typescript-eslint reads code with TypeScript 6 (.pnpmfile.cjs)', () => {
  // TypeScript 7 has no JavaScript API. If the pnpm hook stops applying (a typescript-eslint update
  // renames its peer), lint would break with a confusing error; this says why instead.
  // pnpm keeps each package in a node_modules folder next to its own dependencies, so a package's
  // `typescript` is the folder beside it.
  const versionIn = async (nodeModules: string) =>
    (JSON.parse(await readFile(path.join(nodeModules, 'typescript', 'package.json'), 'utf8')) as { version: string }).version;

  it('gives the package that parses our code typescript 6.x, while the repo typechecks with 7', async () => {
    const tseslint = await realpath(`${ROOT}node_modules/typescript-eslint`);
    const estree = await realpath(path.join(tseslint, '..', '@typescript-eslint', 'typescript-estree'));
    expect(await versionIn(path.join(estree, '..', '..'))).toMatch(/^6\./);
    expect(await versionIn(`${ROOT}node_modules`)).toMatch(/^7\./);
  });
});
