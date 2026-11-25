import { describe, expect, it } from 'vitest';
import { findSecrets, readEnvSecrets } from './scanBundle';

// Fake keys built at run time, so this file itself never contains a key-shaped string that a
// secret scanner (GitHub's, or ours) would flag.
const fake = (prefix: string, length: number) => prefix + 'A1b2C3d4'.repeat(Math.ceil(length / 8)).slice(0, length);

describe('findSecrets', () => {
  it.each([
    ['an Anthropic API key', fake('sk-' + 'ant-api03-', 40)],
    ['an OpenAI project or service key', fake('sk-' + 'proj-', 40)],
    ['an OpenAI project or service key', fake('sk-' + 'svcacct-', 40)],
    ['an OpenAI legacy key', fake('sk-', 48)],
    ['a server key variable name', 'const k = import.meta.env.ANTHROPIC_API_KEY'],
    ['a server key variable name', '"IMAGE_API_KEY"'],
    ['a server key variable name', 'OPENAI_API_KEY'],
    ['a server key variable name', 'import.meta.env.VITE_ANTHROPIC_API_KEY'],
  ])('finds %s', (name, text) => {
    expect(findSecrets(`var a=1;${text};var b=2`)).toContain(name);
  });

  it.each([
    ['ordinary minified code', 'function task(e){return e.disk-space+sk-1}var mask-image=1'],
    ['a short sk- word', 'sk-short sk-ant-tiny'],
    ['nothing', ''],
  ])('finds nothing in %s', (_label, text) => {
    expect(findSecrets(text)).toEqual([]);
  });

  it('finds a value from .env in any format, without saying what it is', () => {
    const secret = fake('x9-', 30);
    expect(findSecrets(`var k="${secret}"`, [secret])).toEqual(['a value from .env']);
    expect(findSecrets('var k="other"', [secret])).toEqual([]);
  });
});

describe('readEnvSecrets', () => {
  it('keeps long values and skips short ones, addresses, lists and comments', () => {
    const key = fake('k-', 30);
    const env = [
      '# Copy to .env',
      `ANTHROPIC_API_KEY=${key}`,
      `export IMAGE_API_KEY="${key}2"`,
      `QUOTED='${key}3'`,
      'DAILY_BUDGET_USD=2.00',
      'ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173',
      'VITE_WS_URL=wss://sketch.example.com/sync',
      'EMPTY=',
      '',
    ].join('\n');
    expect(readEnvSecrets(env)).toEqual([key, `${key}2`, `${key}3`]);
  });

  it('ends an unquoted value at an inline comment, but keeps a # inside quotes', () => {
    const key = fake('k-', 30);
    expect(readEnvSecrets(`A=${key} # production key\nB="${key}#2"\nC='${key}3' # quoted, then a comment`)).toEqual([key, `${key}#2`, `${key}3`]);
  });

  it('reads Windows line endings', () => {
    const key = fake('k-', 30);
    expect(readEnvSecrets(`A=${key}\r\nB=1\r\n`)).toEqual([key]);
  });
});
