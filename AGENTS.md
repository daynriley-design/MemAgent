<!-- memagent:start (généré, ne pas éditer à la main) -->
## MemAgent — Shared project instructions
When instructions conflict, prefer private project instructions over shared project instructions, and shared project instructions over global preferences.
### Rules
- [2cd05198cd73] Utiliser pnpm pour ce monorepo ; les scripts de validation sont pnpm build, pnpm check et pnpm test.
- [dd4a6adf848c] La logique de stockage et de synchronisation est dans packages/core/src ; le CLI est dans packages/cli/src.
- [067f3ac757db] Compiler avec pnpm build avant pnpm test : les tests CLI utilisent les fichiers dist générés.
### Decisions
- [3c84484f60a8] (2026-11-17T07:38:34.368Z) La source de vérité est le Markdown dans .memagent ; Claude Code et Codex consomment des exports générés. Pas de SQLite ni de MCP dans ce MVP.
### Notes
- [2f6f3864c939] La publication npm reste a faire. Verifier le parcours depuis les sources avant publication.
<!-- memagent:end -->
