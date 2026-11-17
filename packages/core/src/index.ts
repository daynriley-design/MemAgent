import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

export type Kind = 'rule' | 'decision' | 'note';
export type Scope = 'project' | 'private' | 'global';
export type Agent = 'claude' | 'codex';
export interface Entry {
  id: string;
  type: Kind;
  created_at: string;
  expires_at: string | null;
  text: string;
}
export interface Context { root: string; home: string; claudeDir: string; codexDir: string; globalDir: string; agents?: Agent[] }
const kinds: Kind[] = ['rule', 'decision', 'note'];
const titles = { rule: 'Rules', decision: 'Decisions', note: 'Notes' };
export const START = '<!-- memagent:start (généré, ne pas éditer à la main) -->';
export const END = '<!-- memagent:end -->';
export function context(root = process.cwd(), home = homedir()): Context {
  return {
    root: resolve(root), home,
    claudeDir: process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'),
    codexDir: process.env.CODEX_HOME || join(home, '.codex'),
    globalDir: join(home, '.config', 'memagent'),
  };
}
export async function configuredAgents(c: Context): Promise<Agent[]> {
  if (c.agents) return validateAgents(c.agents);
  const config = await readOptional(join(c.root, '.memagent', 'config.json'));
  // Existing Claude-only projects keep their behavior until explicitly enabled.
  if (config === null) return ['claude'];
  return validateAgents(JSON.parse(config).agents);
}
function validateAgents(agents: unknown): Agent[] {
  if (!Array.isArray(agents) || !agents.length || agents.some(a => a !== 'claude' && a !== 'codex')) {
    throw new Error('Configuration agents invalide : liste non vide de claude et/ou codex attendue.');
  }
  return [...new Set(agents)] as Agent[];
}
export async function findRoot(start = process.cwd(), required = true): Promise<string> {
  let dir = resolve(start);
  for (;;) {
    if (await readOptional(join(dir, '.memagent', 'memory.md')) !== null) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      if (!required) return resolve(start);
      throw new Error('Projet non initialisé. Lancez memagent init à sa racine.');
    }
    dir = parent;
  }
}
export function source(c: Context, scope: Scope): string {
  return scope === 'global' ? join(c.globalDir, 'memory.md') :
    join(c.root, '.memagent', scope === 'private' ? 'memory.local.md' : 'memory.md');
}
export async function readOptional(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
async function atomicWrite(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}
export function serialize(entries: Entry[]): string {
  return '# MemAgent memory\n\n' + kinds.map(type => `## ${titles[type]}\n\n` +
    entries.filter(e => e.type === type).map(({ text, ...meta }) =>
      `<!-- memagent:entry ${JSON.stringify(meta)} -->\n${text}\n<!-- memagent:entry:end -->\n\n`).join('')).join('');
}
function validDate(s: unknown): s is string {
  return typeof s === 'string' && Number.isFinite(Date.parse(s));
}
export function parse(content: string): Entry[] {
  const entries: Entry[] = [];
  const pattern = /<!-- memagent:entry (\{[^\r\n]*\}) -->\r?\n([\s\S]*?)\r?\n<!-- memagent:entry:end -->/g;
  const rest = content.replace(pattern, (_match, metadata: string, text: string) => {
    const meta = JSON.parse(metadata) as Entry;
    if (!/^[a-f0-9]{12}$/.test(meta.id) || !kinds.includes(meta.type) ||
        !validDate(meta.created_at) || (meta.expires_at !== null && !validDate(meta.expires_at)) ||
        (meta.type !== 'note' && meta.expires_at !== null) || !text.trim() ||
        text.includes('<!-- memagent:') || entries.some(e => e.id === meta.id)) {
      throw new Error('Entrée mémoire invalide ou ID dupliqué.');
    }
    entries.push({ id: meta.id, type: meta.type, created_at: meta.created_at, expires_at: meta.expires_at, text });
    return '';
  });
  if (rest.replace(/^# MemAgent memory\r?$/gm, '').replace(/^## (Rules|Decisions|Notes)\r?$/gm, '').trim()) {
    throw new Error('Format mémoire invalide : texte hors des entrées ou marqueurs mal formés.');
  }
  return entries;
}
export async function load(c: Context, scope: Scope): Promise<Entry[]> {
  const value = await readOptional(source(c, scope));
  return value === null ? [] : parse(value);
}
export function expired(e: Entry, now = new Date()): boolean {
  return e.type === 'note' && e.expires_at !== null && Date.parse(e.expires_at) <= now.getTime();
}
export function renderBlock(entries: Entry[], scope: Scope, now = new Date()): string {
  const active = entries.filter(e => !expired(e, now)).sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const label = { global: 'Global personal preferences', project: 'Shared project instructions', private: 'Private project instructions' }[scope];
  return [START, '## MemAgent — ' + label,
    'When instructions conflict, prefer private project instructions over shared project instructions, and shared project instructions over global preferences.',
    ...kinds.flatMap(type => {
      const items = active.filter(e => e.type === type);
      return items.length ? [`### ${titles[type]}`, ...items.map(e =>
        `- [${e.id}] ${e.type === 'decision' ? `(${e.created_at}) ` : ''}${e.text.replace(/\n/g, '\n  ')}`)] : [];
    }), END].join('\n');
}
export function spliceBlock(content: string, block: string): string {
  const starts = [...content.matchAll(/<!-- memagent:start[^\r\n]*?-->/g)];
  const ends = [...content.matchAll(/<!-- memagent:end -->/g)];
  const hasPartial = content.includes('<!-- memagent:start') || content.includes('<!-- memagent:end');
  if (!starts.length && !ends.length && !hasPartial) return content + (content && !content.endsWith('\n') ? '\n\n' : content ? '\n' : '') + block + '\n';
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index! >= ends[0].index! ||
      content.split('<!-- memagent:start').length !== 2 || content.split('<!-- memagent:end').length !== 2) {
    throw new Error('Marqueurs MemAgent mal formés ou dupliqués : aucun fichier modifié.');
  }
  return content.slice(0, starts[0].index) + block + content.slice(ends[0].index! + END.length);
}
type Planned = { path: string; before: string | null; after: string };
const exec = promisify(execFile);
async function planPrivacy(c: Context, agents: Agent[]): Promise<Planned> {
  const privatePaths = ['.memagent/memory.local.md',
    ...(agents.includes('claude') ? ['CLAUDE.local.md'] : []),
    ...(agents.includes('codex') ? ['AGENTS.override.md'] : [])];
  try {
    const { stdout } = await exec('git', ['-C', c.root, 'ls-files', '-z', '--', ...privatePaths], {
      env: { ...process.env, LC_ALL: 'C' },
    });
    if (stdout) {
      throw new Error(`Fichier privé déjà suivi par Git : ${stdout.split('\0').filter(Boolean).join(', ')}. Retirez-le du suivi avant de synchroniser ; .gitignore ne suffit pas.`);
    }
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stderr?: string };
    // Git is optional for plain folders. Unexpected Git failures must not hide a privacy problem.
    if (e.code !== 'ENOENT' && !(Number(e.code) === 128 && e.stderr?.includes('not a git repository'))) throw error;
  }
  const path = join(c.root, '.gitignore');
  const before = await readOptional(path);
  const content = before ?? '';
  const suffix = privatePaths.map(p => `/${p}\n`).join('');
  // Append after existing negations, preserving every existing byte.
  const after = content.endsWith(suffix) ? content : content + (content && !content.endsWith('\n') ? '\n' : '') + suffix;
  return { path, before, after };
}
async function planSync(c: Context, overrides = new Map<Scope, Entry[]>(), now = new Date(), globalOnly = false): Promise<Planned[]> {
  const agents = await configuredAgents(c);
  const scopes: Scope[] = globalOnly ? ['global'] : ['project', 'private', 'global'];
  const entries = new Map(await Promise.all(scopes.map(async scope =>
    [scope, overrides.get(scope) ?? await load(c, scope)] as const)));
  const plans: Planned[] = [];
  if (agents.includes('claude')) plans.push(...await Promise.all(scopes.map(async scope => {
    const path = scope === 'global' ? join(c.claudeDir, 'CLAUDE.md') : join(c.root, scope === 'private' ? 'CLAUDE.local.md' : 'CLAUDE.md');
    const before = await readOptional(path);
    return { path, before, after: spliceBlock(before ?? '', renderBlock(entries.get(scope)!, scope, now)) };
  })));
  if (agents.includes('codex')) plans.push(...await planCodex(c, entries, now, globalOnly));
  return globalOnly ? plans : [await planPrivacy(c, agents), ...plans];
}
async function planCodex(c: Context, entries: Map<Scope, Entry[]>, now: Date, globalOnly: boolean): Promise<Planned[]> {
  const globalOverride = join(c.codexDir, 'AGENTS.override.md');
  const overrideBefore = await readOptional(globalOverride);
  const globalPath = overrideBefore !== null ? globalOverride : join(c.codexDir, 'AGENTS.md');
  const globalBefore = overrideBefore ?? await readOptional(globalPath);
  const plans: Planned[] = [{ path: globalPath, before: globalBefore,
    after: spliceBlock(globalBefore ?? '', renderBlock(entries.get('global')!, 'global', now)) }];
  if (globalOnly) return plans;
  const sharedPath = join(c.root, 'AGENTS.md');
  const sharedBefore = await readOptional(sharedPath);
  const sharedAfter = spliceBlock(sharedBefore ?? '', renderBlock(entries.get('project')!, 'project', now));
  plans.push({ path: sharedPath, before: sharedBefore, after: sharedAfter });
  const privatePath = join(c.root, 'AGENTS.override.md');
  const privateBefore = await readOptional(privatePath);
  const privateEntries = entries.get('private')!;
  // An override replaces AGENTS.md at this directory. Include all shared guidance
  // inside the managed block so manual team instructions remain available too.
  if (privateBefore !== null || privateEntries.some(e => !expired(e, now))) {
    const sharedBody = sharedAfter.replace(START, '').replace(END, '').trim();
    const privateBody = renderBlock(privateEntries, 'private', now).slice(START.length, -END.length).trim();
    const combined = [START, '# MemAgent — Codex project context', sharedBody, privateBody, END].join('\n\n');
    plans.push({ path: privatePath, before: privateBefore, after: spliceBlock(privateBefore ?? '', combined) });
  }
  return plans;
}
async function commit(plans: Planned[]): Promise<void> {
  for (const p of plans) if (p.before !== p.after) await atomicWrite(p.path, p.after);
}
export async function sync(c: Context, globalOnly = false, now = new Date()): Promise<void> {
  await commit(await planSync(c, new Map(), now, globalOnly));
}
export async function init(c: Context, agents?: Agent[]): Promise<void> {
  const selected = agents ? validateAgents(agents) : await configuredAgents(c);
  c = { ...c, agents: selected };
  const path = source(c, 'project');
  const before = await readOptional(path);
  if (before !== null) parse(before);
  // Validate all destinations before creating or modifying files.
  const plans = await planSync(c);
  const configPath = join(c.root, '.memagent', 'config.json');
  const configBefore = await readOptional(configPath);
  // Keep unrelated configuration keys when changing targets.
  const config = configBefore === null ? {} : JSON.parse(configBefore);
  const configAfter = JSON.stringify({ ...config, agents: selected }, null, 2) + '\n';
  await commit([plans[0], { path, before, after: before ?? serialize([]) },
    { path: configPath, before: configBefore, after: configAfter }, ...plans.slice(1)]);
}
export function ttlExpiry(ttl: string, now: Date): string | null {
  if (ttl === 'never') return null;
  const match = /^([1-9]\d*)d$/.exec(ttl);
  if (!match) throw new Error('TTL invalide : utilisez 7d, 14d ou never.');
  const end = now.getTime() + Number(match[1]) * 86_400_000;
  if (!Number.isFinite(end) || end > 8.64e15) throw new Error('TTL trop grand.');
  return new Date(end).toISOString();
}
export async function add(c: Context, type: Kind, text: string, scope: Scope = 'project', ttl?: string, now = new Date()): Promise<Entry> {
  if (!kinds.includes(type)) throw new Error('Type invalide : rule, decision ou note.');
  text = text.trim().replace(/\r\n/g, '\n');
  if (!text || text.includes('<!-- memagent:')) throw new Error('Texte vide ou marqueur MemAgent réservé.');
  if (ttl !== undefined && type !== 'note') throw new Error('--ttl est réservé aux notes.');
  const entry: Entry = { id: randomUUID().replace(/-/g, '').slice(0, 12), type, text,
    created_at: now.toISOString(), expires_at: type === 'note' ? ttlExpiry(ttl ?? '7d', now) : null };
  const entries = [...await load(c, scope), entry];
  const plans = await planSync(c, new Map([[scope, entries]]), now, scope === 'global');
  // Update ignore rules before writing any private source or destination.
  if (scope !== 'global') await commit([plans.shift()!]);
  await atomicWrite(source(c, scope), serialize(entries));
  await commit(plans);
  return entry;
}
export async function remove(c: Context, id: string, scope: Scope = 'project'): Promise<void> {
  const entries = await load(c, scope);
  if (!entries.some(e => e.id === id)) throw new Error(`ID introuvable dans cette portée : ${id}`);
  const remaining = entries.filter(e => e.id !== id);
  const plans = await planSync(c, new Map([[scope, remaining]]), new Date(), scope === 'global');
  if (scope !== 'global') await commit([plans.shift()!]);
  await atomicWrite(source(c, scope), serialize(remaining));
  await commit(plans);
}
