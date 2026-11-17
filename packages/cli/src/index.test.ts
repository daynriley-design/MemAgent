import { afterEach, beforeEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const cli = resolve('packages/cli/dist/index.js');
let dir: string;
let root: string;
let env: NodeJS.ProcessEnv;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memagent-cli-'));
  root = join(dir, 'project');
  const home = join(dir, 'home');
  await mkdir(root);
  await mkdir(home);
  env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex') };
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const run = (...args: string[]) => exec(process.execPath, [cli, ...args], { cwd: root, env });

it('exercises init, add, list, remove and sync through the compiled CLI', async () => {
  await run('init');
  const added = await run('add', 'rule', 'Use pnpm');
  const id = /[a-f0-9]{12}/.exec(added.stdout)![0];
  expect((await run('list')).stdout).toContain('Use pnpm');
  await run('add', 'note', 'Private task', '--private', '--ttl', 'never');
  expect((await run('list', '--private')).stdout).toContain('Private task');
  expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).not.toContain('Private task');
  expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('Use pnpm');
  expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).not.toContain('Private task');
  const override = await readFile(join(root, 'AGENTS.override.md'), 'utf8');
  expect(override).toContain('Use pnpm');
  expect(override).toContain('Private task');
  await run('remove', id);
  expect((await run('list')).stdout).not.toContain('Use pnpm');
  expect(await readFile(join(root, 'AGENTS.override.md'), 'utf8')).not.toContain('Use pnpm');
  await run('sync');
});

it('rejects incompatible scopes and invalid TTL without persisting entries', async () => {
  await run('init');
  await expect(run('add', 'rule', 'No', '--global', '--private')).rejects.toThrow('incompatibles');
  await expect(run('add', 'rule', 'No', '--ttl', '7d')).rejects.toThrow('réservé');
  await expect(run('add', 'note', 'No', '--ttl', 'yesterday')).rejects.toThrow('TTL');
  expect((await run('list')).stdout).toBe('');
});

it('supports global memory outside an initialized project', async () => {
  await run('add', 'rule', 'Global preference', '--global');
  expect((await run('list', '--global')).stdout).toContain('Global preference');
  expect(await readFile(join(env.CLAUDE_CONFIG_DIR!, 'CLAUDE.md'), 'utf8')).toContain('Global preference');
});

it('syncs before run, forwards arguments without shell expansion and propagates exit codes', async () => {
  await run('init');
  await run('add', 'rule', 'Use pnpm');
  await writeFile(join(root, 'CLAUDE.md'), '# User instructions\n');
  const child = join(dir, 'child.cjs');
  await writeFile(child, "const fs=require('node:fs');if(!fs.readFileSync('CLAUDE.md','utf8').includes('Use pnpm'))process.exit(9);console.log(process.argv[2]);process.exit(7);");
  try {
    await run('run', '--', process.execPath, child, 'literal & argument');
    throw new Error('Expected exit code 7');
  } catch (error) {
    expect((error as { code: number }).code).toBe(7);
    expect((error as { stdout: string }).stdout).toContain('literal & argument');
  }
});

it('never launches a child when sync fails', async () => {
  await run('init');
  await writeFile(join(root, 'CLAUDE.md'), '<!-- memagent:start -->');
  const child = join(dir, 'child.cjs');
  await writeFile(child, "require('node:fs').writeFileSync('launched.txt','yes');");
  await expect(run('run', '--', process.execPath, child)).rejects.toThrow('mal formés');
  await expect(readFile(join(root, 'launched.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('supports Codex-only initialization and global sync outside a project', async () => {
  await run('init', '--agent', 'codex');
  await run('init');
  expect(JSON.parse(await readFile(join(root, '.memagent', 'config.json'), 'utf8')).agents).toEqual(['codex']);
  await run('add', 'rule', 'Use Codex');
  expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('Use Codex');
  await expect(readFile(join(root, 'CLAUDE.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  await run('add', 'rule', 'Global Codex preference', '--global', '--agent', 'codex');
  expect(await readFile(join(env.CODEX_HOME!, 'AGENTS.md'), 'utf8')).toContain('Global Codex preference');
  await expect(run('sync', '--agent', 'invalid')).rejects.toThrow('invalid');
});

it('selects Codex while preserving custom executable arguments and their exit code', async () => {
  await run('init', '--agent', 'claude');
  await run('add', 'rule', 'Shared across agents');
  const child = join(dir, 'check-codex.cjs');
  await writeFile(child, "const fs=require('node:fs');if(!fs.readFileSync('AGENTS.md','utf8').includes('Shared across agents'))process.exit(9);console.log(process.argv[2]);process.exit(6);");
  try {
    await run('run', '--agent', 'codex', '--', process.execPath, child, '--literal');
    throw new Error('Expected child exit code');
  } catch (error) {
    expect((error as { code: number }).code).toBe(6);
    expect((error as { stdout: string }).stdout).toContain('--literal');
  }
});

it('uses the configured targets for global changes from a project subdirectory', async () => {
  await run('init', '--agent', 'codex');
  const nested = join(root, 'apps', 'api');
  await mkdir(nested, { recursive: true });
  await exec(process.execPath, [cli, 'add', 'rule', 'Global from nested directory', '--global'], { cwd: nested, env });
  expect(await readFile(join(env.CODEX_HOME!, 'AGENTS.md'), 'utf8')).toContain('Global from nested directory');
  await expect(readFile(join(env.CLAUDE_CONFIG_DIR!, 'CLAUDE.md'))).rejects.toMatchObject({ code: 'ENOENT' });
});
