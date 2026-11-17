# MemAgent

Une mémoire Markdown commune à Claude Code et Codex : consignes, décisions et notes de session, conservées avec votre projet.

Version de développement sous licence MIT. La publication npm reste à finaliser. Cette archive contient le CLI complet, sans dépendance d'exécution à installer séparément. Node.js 22+ requis.

## Installer une archive locale

```sh
pnpm add --global /chemin/vers/memagent-0.1.0.tgz
```

Puis, dans le projet à mémoriser :

```sh
memagent init --agent both
memagent add rule "Utiliser pnpm"
memagent add decision "Markdown est notre source de vérité"
memagent add note "Il reste les tests e2e" --ttl 7d
memagent add rule "Comptes rendus en français" --private
memagent list
memagent run --agent codex
```

`init` crée les mémoires et leurs exports, et ajoute les fichiers privés au `.gitignore`. Il peut aussi créer les blocs globaux dans votre dossier utilisateur. Les ajouts et suppressions synchronisent les agents configurés. Les notes expirent après sept jours par défaut et restent dans la source après expiration.

Les mémoires partagées vont dans `CLAUDE.md` et `AGENTS.md`. Les entrées privées restent dans `CLAUDE.local.md` et `AGENTS.override.md`, qui ne doivent pas être suivis par Git. Les fichiers existants sont préservés en dehors des blocs générés. `--global` sélectionne la mémoire personnelle commune à vos projets ; il est incompatible avec `--private`.

Claude Code ou Codex doit être installé et authentifié séparément pour être lancé. Les instructions ne garantissent pas l'obéissance du modèle. Voir le [dépôt et la documentation complète](https://github.com/daynriley-design/MemAgent).
