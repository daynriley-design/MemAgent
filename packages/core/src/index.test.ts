import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { add, context, END, expired, findRoot, init, load, parse, remove, renderBlock, serialize, source, spliceBlock, START, sync, ttlExpiry, type Context } from './index.js';

let sandbox: string;
let c: Context;
const exec = promisify(execFile);
beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'memagent-test-'));
  c = context(join(sandbox, 'project'), join(sandbox, 'home'));
  c.claudeDir = join(sandbox, 'home', '.claude');
  c.codexDir = join(sandbox, 'home', '.codex');
  await mkdir(c.root, { recursive: true });
});
afterEach(async () => { await rm(sandbox, { recursive: true, force: true }); });

describe('project memory lifecycle', () => {
  it('initializes without losing existing instructions and remains byte-for-byte stable', async () => {
    await writeFile(join(c.root, 'CLAUDE.md'), '# Existing\r\nKeep this.\r\n');
    await init(c);
    const first = await readFile(join(c.root, 'CLAUDE.md'), 'utf8');
    expect(first.startsWith('# Existing\r\nKeep this.\r\n')).toBe(true);
    await init(c);
    expect(await readFile(join(c.root, 'CLAUDE.md'), 'utf8')).toBe(first);
    const ignore = await readFile(join(c.root, '.gitignore'), 'utf8');
    expect(ignore).toContain('/.memagent/memory.local.md\n');
    expect(ignore).toContain('/CLAUDE.local.md\n');
  });
  it('routes all three scopes without leaking private project information', async () => {
    await init(c);
    await add(c, 'rule', 'Use pnpm');
    await add(c, 'decision', 'PostgreSQL — ADR-003');
    await add(c, 'rule', 'Project A private', 'private');
    await add(c, 'rule', 'English commits', 'global');
    const shared = await readFile(join(c.root, 'CLAUDE.md'), 'utf8');
    const personal = await readFile(join(c.root, 'CLAUDE.local.md'), 'utf8');
    const global = await readFile(join(c.claudeDir, 'CLAUDE.md'), 'utf8');
    expect(shared).toContain('Use pnpm');
    expect(shared).toContain('ADR-003');
    expect(shared).not.toContain('Project A private');
    expect(shared).not.toContain('English commits');
    expect(personal).toContain('Project A private');
    expect(global).toContain('English commits');
    expect(global).not.toContain('Project A private');
    const other = { ...c, root: join(sandbox, 'project-b') };
    await mkdir(other.root);
    await init(other);
    expect(await readFile(join(other.root, 'CLAUDE.local.md'), 'utf8')).not.toContain('Project A private');
  });
  it('expires a note at seven days, retains the source, and supports never', async () => {
    await init(c);
    const monday = new Date('2026-11-16T09:00:00Z');
    const e = await add(c, 'note', 'Auth tests pending', 'project', undefined, monday);
    expect(e.expires_at).toBe('2026-11-23T09:00:00.000Z');
    expect(renderBlock([e], 'project', new Date('2026-11-19T09:00:00Z'))).toContain(e.text);
    await sync(c, false, new Date('2026-11-23T09:00:00Z'));
    expect(await readFile(join(c.root, 'CLAUDE.md'), 'utf8')).not.toContain(e.text);
    expect((await load(c, 'project'))[0].text).toBe(e.text);
    const permanent = await add(c, 'note', 'Persistent', 'private', 'never');
    expect(expired(permanent, new Date('2099-01-01'))).toBe(false);
  });
  it('removes a rule and refreshes the generated file', async () => {
    await init(c);
    const e = await add(c, 'rule', 'Do not touch legacy');
    await remove(c, e.id);
    expect(await load(c, 'project')).toEqual([]);
    expect(await readFile(join(c.root, 'CLAUDE.md'), 'utf8')).not.toContain(e.text);
    await expect(remove(c, e.id)).rejects.toThrow('introuvable');
  });
  it('rejects malformed destinations before changing any source or destination', async () => {
    await init(c);
    const sourceBefore = await readFile(source(c, 'project'), 'utf8');
    const sharedBefore = await readFile(join(c.root, 'CLAUDE.md'), 'utf8');
    await writeFile(join(c.root, 'CLAUDE.local.md'), START);
    await expect(add(c, 'rule', 'Should not be saved')).rejects.toThrow('mal formés');
    expect(await readFile(source(c, 'project'), 'utf8')).toBe(sourceBefore);
    expect(await readFile(join(c.root, 'CLAUDE.md'), 'utf8')).toBe(sharedBefore);
  });
  it('finds initialized roots from nested directories', async () => {
    await init(c);
    expect(await findRoot(join(c.root, 'apps', 'api'))).toBe(c.root);
  });
  it('round trips multiline text and rejects corruption', async () => {
    await init(c);
    const e = await add(c, 'decision', 'PostgreSQL\nReason: tenant isolation');
    expect(parse(serialize([e]))).toEqual([e]);
    expect(() => parse(serialize([e]) + 'unexpected text')).toThrow('Format');
    await expect(add(c, 'rule', '<!-- memagent:start -->')).rejects.toThrow('réservé');
  });
  it('restores ignore rules during sync after deletion or a later negation', async () => {
    await init(c);
    await writeFile(join(c.root, '.gitignore'), '# Keep this\n!CLAUDE.local.md\n');
    await sync(c);
    const ignore = await readFile(join(c.root, '.gitignore'), 'utf8');
    expect(ignore.startsWith('# Keep this\n!CLAUDE.local.md\n')).toBe(true);
    expect(ignore.endsWith('/.memagent/memory.local.md\n/CLAUDE.local.md\n')).toBe(true);
    await sync(c);
    expect(await readFile(join(c.root, '.gitignore'), 'utf8')).toBe(ignore);
  });
  it.each(['CLAUDE.local.md', '.memagent/memory.local.md'])('refuses to write when private file is tracked: %s', async path => {
    await init(c);
    await exec('git', ['init', c.root]);
    if (path.includes('/')) await writeFile(join(c.root, path), serialize([]));
    await exec('git', ['-C', c.root, 'add', '-f', '--', path]);
    const before = await readFile(join(c.root, path), 'utf8');
    const sharedBefore = await readFile(source(c, 'project'), 'utf8');
    await expect(add(c, 'rule', 'Never write this', 'private')).rejects.toThrow('déjà suivi');
    await expect(sync(c)).rejects.toThrow('déjà suivi');
    expect(await readFile(join(c.root, path), 'utf8')).toBe(before);
    expect(await readFile(source(c, 'project'), 'utf8')).toBe(sharedBefore);
  });
});

describe('safe block replacement', () => {
  it('preserves prefix and suffix and accepts an empty block', () => {
    const block = START + '\n' + END;
    expect(spliceBlock('prefix\n' + block + '\nsuffix', block)).toBe('prefix\n' + block + '\nsuffix');
    expect(spliceBlock('', block)).toBe(block + '\n');
  });
  it.each([START, END, END + START, START + END + START + END, '<!-- memagent:start'])('rejects malformed markers: %s', input => {
    expect(() => spliceBlock(input, START + '\n' + END)).toThrow('mal formés');
  });
  it('validates TTL values', () => {
    expect(ttlExpiry('14d', new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-15T00:00:00.000Z');
    for (const invalid of ['0d', '-1d', 'tomorrow', '1h']) expect(() => ttlExpiry(invalid, new Date())).toThrow('TTL');
  });
});

describe('Codex target', () => {
  it('keeps public, private and global entries separated and includes manual shared guidance in the override', async () => {
    await writeFile(join(c.root, 'AGENTS.md'), '# Team guidance\nKeep API compatibility.\n');
    await init(c, ['claude', 'codex']);
    await expect(readFile(join(c.root, 'AGENTS.override.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await add(c, 'rule', 'Use pnpm');
    await add(c, 'rule', 'Private preference', 'private');
    await add(c, 'rule', 'Global preference', 'global');
    const shared = await readFile(join(c.root, 'AGENTS.md'), 'utf8');
    const personal = await readFile(join(c.root, 'AGENTS.override.md'), 'utf8');
    expect(shared).toContain('Use pnpm');
    expect(shared).not.toContain('Private preference');
    expect(shared).not.toContain('Global preference');
    expect(personal).toContain('Keep API compatibility.');
    expect(personal).toContain('Use pnpm');
    expect(personal).toContain('Private preference');
    expect(personal.indexOf('Use pnpm')).toBeLessThan(personal.indexOf('Private preference'));
    expect(await readFile(join(c.codexDir, 'AGENTS.md'), 'utf8')).toContain('Global preference');
    expect(await readFile(join(c.codexDir, 'AGENTS.md'), 'utf8')).not.toContain('Private preference');
    await sync(c);
    expect(await readFile(join(c.root, 'AGENTS.override.md'), 'utf8')).toBe(personal);
  });
  it('preserves existing local and global overrides, updating the file Codex actually loads', async () => {
    await mkdir(c.codexDir, { recursive: true });
    await writeFile(join(c.codexDir, 'AGENTS.override.md'), '# Global override\nMy existing preference.\n');
    await writeFile(join(c.root, 'AGENTS.override.md'), '# Local override\nMy local preference.\n');
    await init(c, ['codex']);
    await add(c, 'rule', 'Shared instruction');
    await add(c, 'rule', 'Personal global instruction', 'global');
    const local = await readFile(join(c.root, 'AGENTS.override.md'), 'utf8');
    expect(local.startsWith('# Local override\nMy local preference.\n')).toBe(true);
    expect(local).toContain('Shared instruction');
    const global = await readFile(join(c.codexDir, 'AGENTS.override.md'), 'utf8');
    expect(global.startsWith('# Global override\nMy existing preference.\n')).toBe(true);
    expect(global).toContain('Personal global instruction');
    await expect(readFile(join(c.codexDir, 'AGENTS.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refreshes the shared snapshot and removes expired private notes without deleting manual text', async () => {
    await init(c, ['codex']);
    const now = new Date('2026-11-17T12:00:00Z');
    await add(c, 'note', 'Private temporary task', 'private', '7d', now);
    await writeFile(join(c.root, 'AGENTS.md'), '# Updated team instructions\n');
    await sync(c, false, new Date('2026-11-25T12:00:00Z'));
    const override = await readFile(join(c.root, 'AGENTS.override.md'), 'utf8');
    expect(override).toContain('Updated team instructions');
    expect(override).not.toContain('Private temporary task');
    expect((await load(c, 'private'))[0].text).toBe('Private temporary task');
  });
  it('refuses tracked private overrides before changing either agent or any source', async () => {
    await init(c, ['claude', 'codex']);
    await add(c, 'rule', 'Private entry', 'private');
    await exec('git', ['init', c.root]);
    await exec('git', ['-C', c.root, 'add', '-f', 'AGENTS.override.md']);
    const before = await readFile(join(c.root, 'CLAUDE.md'), 'utf8');
    await expect(add(c, 'rule', 'Rejected shared entry')).rejects.toThrow('déjà suivi');
    expect(await readFile(join(c.root, 'CLAUDE.md'), 'utf8')).toBe(before);
    expect(await load(c, 'project')).toEqual([]);
  });
  it('validates both targets before changing sources when Codex markers are malformed', async () => {
    await init(c, ['claude', 'codex']);
    const before = await readFile(join(c.root, 'CLAUDE.md'), 'utf8');
    await writeFile(join(c.root, 'AGENTS.override.md'), START);
    await expect(add(c, 'rule', 'Rejected')).rejects.toThrow('mal formés');
    expect(await load(c, 'project')).toEqual([]);
    expect(await readFile(join(c.root, 'CLAUDE.md'), 'utf8')).toBe(before);
  });
  it('keeps project-private data isolated between projects', async () => {
    await init(c, ['codex']);
    await add(c, 'rule', 'Project A private', 'private');
    const other = { ...c, root: join(sandbox, 'other') };
    await mkdir(other.root);
    await init(other, ['codex']);
    await add(other, 'rule', 'Project B private', 'private');
    expect(await readFile(join(other.root, 'AGENTS.override.md'), 'utf8')).not.toContain('Project A private');
    expect(await readFile(join(c.root, 'AGENTS.override.md'), 'utf8')).not.toContain('Project B private');
  });
});
