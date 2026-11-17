# MemAgent memory

## Rules

<!-- memagent:entry {"id":"2cd05198cd73","type":"rule","created_at":"2026-11-17T07:38:33.755Z","expires_at":null} -->
Utiliser pnpm pour ce monorepo ; les scripts de validation sont pnpm build, pnpm check et pnpm test.
<!-- memagent:entry:end -->

<!-- memagent:entry {"id":"dd4a6adf848c","type":"rule","created_at":"2026-11-17T07:38:33.951Z","expires_at":null} -->
La logique de stockage et de synchronisation est dans packages/core/src ; le CLI est dans packages/cli/src.
<!-- memagent:entry:end -->

<!-- memagent:entry {"id":"067f3ac757db","type":"rule","created_at":"2026-11-17T07:38:34.158Z","expires_at":null} -->
Compiler avec pnpm build avant pnpm test : les tests CLI utilisent les fichiers dist générés.
<!-- memagent:entry:end -->

## Decisions

<!-- memagent:entry {"id":"3c84484f60a8","type":"decision","created_at":"2026-11-17T07:38:34.368Z","expires_at":null} -->
La source de vérité est le Markdown dans .memagent ; Claude Code et Codex consomment des exports générés. Pas de SQLite ni de MCP dans ce MVP.
<!-- memagent:entry:end -->

## Notes

<!-- memagent:entry {"id":"2f6f3864c939","type":"note","created_at":"2026-11-17T07:39:09.000Z","expires_at":"2026-11-24T07:39:09.000Z"} -->
La publication npm reste a faire. Verifier le parcours depuis les sources avant publication.
<!-- memagent:entry:end -->

