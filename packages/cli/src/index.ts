#!/usr/bin/env node
import { Command, Option } from 'commander';
import { spawn } from 'node:child_process';
import { context, findRoot, init, add, load, remove, sync, expired, readOptional, source, type Agent, type Kind, type Scope } from '@memagent/core';

const program = new Command().name('memagent').description('Mémoire partagée pour Claude Code et Codex').version('0.1.0').enablePositionalOptions();
type Options = { global?: boolean; private?: boolean; ttl?: string; type?: Kind; expired?: boolean; agent?: Agent | 'both' };
function targets(agent: Agent | 'both'): Agent[] { return agent === 'both' ? ['claude', 'codex'] : [agent]; }
function agentOption(command: Command, both = true): Command {
  return command.addOption(new Option('--agent <agent>', 'Agent cible').choices(both ? ['claude', 'codex', 'both'] : ['claude', 'codex']));
}
function scope(o: Options): Scope {
  if (o.global && o.private) throw new Error('--global et --private sont incompatibles.');
  return o.global ? 'global' : o.private ? 'private' : 'project';
}
async function ctx(o: Options = {}) {
  const selected = scope(o);
  return { ...context(await findRoot(process.cwd(), selected !== 'global')), ...(o.agent ? { agents: targets(o.agent) } : {}) };
}
function scoped(command: Command): Command {
  return command.option('--global', 'Mémoire personnelle globale').option('--private', 'Mémoire privée du projet');
}
agentOption(program.command('init').description('Initialiser le projet courant (les deux agents pour un nouveau projet)')).action(async (o: Options) => {
  const c = context();
  const existing = await readOptional(source(c, 'project'));
  await init(c, o.agent ? targets(o.agent) : existing === null ? targets('both') : undefined);
  console.log('MemAgent initialisé.');
});
agentOption(scoped(program.command('add <type> <text>').description('Ajouter une règle, décision ou note')))
  .option('--ttl <duration>', 'Expiration des notes : 7d, 14d ou never')
  .action(async (type: Kind, text: string, o: Options) => {
    const s = scope(o); const entry = await add(await ctx(o), type, text, s, o.ttl);
    console.log(`Ajouté : ${entry.id} (${s}). Mémoire synchronisée.`);
  });
scoped(program.command('list').description('Lister la mémoire de la portée sélectionnée'))
  .addOption(new Option('--type <type>').choices(['rule', 'decision', 'note']))
  .option('--expired', 'Afficher uniquement les notes expirées')
  .action(async (o: Options) => {
    const entries = await load(await ctx(o), scope(o));
    const now = new Date();
    for (const type of ['rule', 'decision', 'note'] as const) {
      const items = entries.filter(e => e.type === type && (!o.type || e.type === o.type) && (o.expired ? expired(e, now) : !expired(e, now)));
      if (items.length) console.log(`${type}:\n${items.map(e => `  ${e.id}  ${e.text}${expired(e, now) ? ' [expirée]' : ''}`).join('\n')}`);
    }
  });
agentOption(scoped(program.command('remove <id>').description('Supprimer une entrée et synchroniser')))
  .action(async (id: string, o: Options) => { await remove(await ctx(o), id, scope(o)); console.log('Entrée supprimée. Mémoire synchronisée.'); });
agentOption(program.command('sync').description('Synchroniser les agents configurés').option('--global', 'Synchroniser uniquement le global'))
  .action(async (o: Options) => { await sync(await ctx(o), !!o.global); console.log('Mémoire synchronisée.'); });
agentOption(program.command('run').description('Synchroniser, puis lancer un agent ou la commande après --'), false)
  .argument('[command...]').passThroughOptions().allowUnknownOption()
  .action(async (args: string[], o: Options) => {
    await sync(await ctx(o));
    const [command = o.agent ?? 'claude', ...argv] = args;
    const child = spawn(command, argv, { stdio: 'inherit', shell: false });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); resolve(); });
    });
  });
program.parseAsync().catch((error: Error) => { console.error(`Erreur : ${error.message}`); process.exitCode = 1; });
