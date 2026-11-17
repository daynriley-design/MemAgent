// Optional acceptance test: uses an installed, authenticated Codex CLI.
// Generates only temporary fixtures; does not change the user's memory files.
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { add, context, init, sync } from '../packages/core/dist/index.js';

const exec = promisify(execFile);
const fixture = await mkdtemp(join(tmpdir(), 'memagent-codex-live-'));
const root = join(fixture, 'project');
const home = join(fixture, 'fixture-home');
await mkdir(root);
const c = { ...context(root, home), codexDir: join(home, '.codex'), claudeDir: join(home, '.claude') };
const publicProbe = randomUUID();
const privateProbe = randomUUID();
const expiredProbe = randomUUID();
await init(c, ['codex']);
await add(c, 'rule', `For the MemAgent test only: memagent_public_probe=${publicProbe}`);
await add(c, 'rule', `For the MemAgent test only: memagent_private_probe=${privateProbe}`, 'private');
await add(c, 'note', `memagent_expired_probe=${expiredProbe}`, 'project', '7d', new Date(Date.now() - 8 * 86_400_000));
await sync(c);
const shared = await readFile(join(root, 'AGENTS.md'), 'utf8');
const personal = await readFile(join(root, 'AGENTS.override.md'), 'utf8');
assert(!shared.includes(privateProbe));
assert(personal.includes(publicProbe) && personal.includes(privateProbe));
assert(!personal.includes(expiredProbe));
const output = join(fixture, 'result.json');
const schema = join(fixture, 'schema.json');
await writeFile(schema, JSON.stringify({
  type: 'object', additionalProperties: false,
  properties: { public_probe: { type: 'string' }, private_probe: { type: 'string' }, expired_probe: { type: ['string', 'null'] } },
  required: ['public_probe', 'private_probe', 'expired_probe'],
}));
console.log('Temporary fixture:', fixture);
console.log('Checking startup memory with the installed Codex CLI...');
try {
  // Keep the real Codex home for authentication, but generate no exports there.
  // User configuration is ignored; the project is read-only and ephemeral.
  const pending = exec(process.env.MEMAGENT_CODEX_BIN || 'codex', [
    'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral',
    '--skip-git-repo-check', '--sandbox', 'read-only', '--json',
    '--output-schema', schema, '--output-last-message', output, '--cd', root,
    'Without opening files, invoking tools, or changing anything, report the values of memagent_public_probe and memagent_private_probe from your startup project instructions. For memagent_expired_probe return null if no value is present in your instructions.',
  ], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  // Codex appends piped stdin to the prompt, so close it for this noninteractive probe.
  pending.child.stdin?.end();
  const { stdout } = await pending;
  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.public_probe, publicProbe, 'Shared project memory was not loaded');
  assert.equal(result.private_probe, privateProbe, 'Private project memory was not loaded');
  assert.equal(result.expired_probe, null, 'Expired note appeared in the context');
  const events = stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const toolTypes = new Set(['command_execution', 'mcp_tool_call', 'web_search', 'file_change']);
  assert(!events.some(e => toolTypes.has(e.item?.type)), 'Codex used a tool instead of only startup instructions');
  console.log('PASS: shared and private startup memory loaded; expired note absent; no tools used.');
} catch (error) {
  console.error('Live Codex acceptance test failed:', error.message);
  if (error.stderr) console.error(error.stderr.slice(-2500));
  process.exitCode = 1;
}
