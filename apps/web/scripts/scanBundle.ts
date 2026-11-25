// Fails the build if the web bundle contains an API key (CLAUDE.md rule 1: keys stay on the
// server). Everything in apps/web/dist is downloaded by every visitor, so a key that ends up there
// (a VITE_ variable, a key pasted into code) is public the moment it's deployed.
//
// Run after `vite build`: `pnpm scan:bundle` (CI does). Node runs this file directly (it strips the
// types), so it needs no build step. It never prints a value it finds, only where and what kind.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shapes of real keys, and the names of our key variables (a name in the bundle means code reads it).
export const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'an Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'an OpenAI project or service key', pattern: /sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/ },
  { name: 'an OpenAI legacy key', pattern: /\bsk-[A-Za-z0-9]{40,}\b/ },
  // Anywhere, also inside a longer name (VITE_ANTHROPIC_API_KEY).
  { name: 'a server key variable name', pattern: /(?:ANTHROPIC|IMAGE|OPENAI)_API_KEY/ },
];

// Values from .env files, when there are any: a real key in any format is caught even if no
// pattern above knows its shape. Only on a machine that has them (yours; CI has none), so run
// `pnpm build && pnpm scan:bundle` there before deploying. Long values only, so "2.00" can't match code.
const MIN_SECRET_LENGTH = 16;
// The server's .env (repo root) and Vite's own (apps/web: .env, .env.local, .env.production, ...),
// which is where a VITE_ variable that ends up in the bundle would come from.
const ENV_FILES = (here: string) => [path.resolve(here, '../../../.env'), path.resolve(here, '..')];

export function readEnvSecrets(envText: string): string[] {
  const values: string[] = [];
  for (const line of envText.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/.exec(line);
    let value = match?.[1]?.trim() ?? '';
    const quoted = /^(['"])(.*?)\1(?:\s+#.*)?$/.exec(value);
    // Unquoted values end at an inline comment: `KEY=abc # prod` is the key `abc`.
    value = quoted ? (quoted[2] ?? '') : value.replace(/\s+#.*$/, '');
    // Keys only: addresses and lists of addresses (ALLOWED_ORIGINS) appear in the bundle legitimately.
    if (value.length >= MIN_SECRET_LENGTH && !/^[a-z]+:\/\//i.test(value) && !value.includes(',')) values.push(value);
  }
  return values;
}

// The text of every .env file the build could have read: the root .env, and apps/web/.env*.
async function readEnvFiles(here: string): Promise<string> {
  const [rootEnv, webDir] = ENV_FILES(here);
  const texts = [await readFile(rootEnv!, 'utf8').catch(() => '')];
  for (const name of await readdir(webDir!).catch(() => [] as string[])) {
    // .env.example holds placeholders, not keys.
    if (name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example'))) texts.push(await readFile(path.join(webDir!, name), 'utf8').catch(() => ''));
  }
  return texts.join('\n');
}

// What was found in one file's text: descriptions only, never the matched text.
export function findSecrets(text: string, envSecrets: readonly string[] = []): string[] {
  const found = SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
  if (envSecrets.some((secret) => text.includes(secret))) found.push('a value from .env');
  return found;
}

async function filesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

async function main(): Promise<number> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, '../dist');
  const envSecrets = readEnvSecrets(await readEnvFiles(here));

  let files: string[];
  try {
    files = await filesIn(dist);
  } catch {
    files = [];
  }
  // Nothing to scan is a failure, not a pass: a check that looked at nothing proves nothing.
  if (files.length === 0) {
    console.error(`scan-bundle: no files in ${dist}. Run the build first.`);
    return 1;
  }

  let problems = 0;
  for (const file of files) {
    for (const what of findSecrets(await readFile(file, 'latin1'), envSecrets)) {
      console.error(`scan-bundle: ${path.relative(dist, file)} contains ${what}.`);
      problems += 1;
    }
  }
  if (problems > 0) {
    console.error('scan-bundle: keys must stay on the server (CLAUDE.md rule 1). Remove them and rotate any real key.');
    return 1;
  }
  console.log(`scan-bundle: ${files.length} files, no keys` + (envSecrets.length > 0 ? ` (also checked ${envSecrets.length} .env values).` : '.'));
  return 0;
}

// Run as a script, not when a test imports it.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
