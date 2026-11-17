# MemAgent

Une mémoire explicite et versionnable pour Claude Code : consignes, décisions techniques et notes de session, sans serveur ni compte.

**État : MVP local, non publié sur npm. Node.js 22.13+ et pnpm 11.25.0 requis pour travailler sur les sources.**

## Démarrer depuis les sources

```sh
pnpm install
pnpm build
pnpm check
pnpm test
```

Depuis le projet à mémoriser, exécutez le CLI compilé (remplacez le chemin par celui de votre clone) :

```sh
node /chemin/vers/MemAgent/packages/cli/dist/index.js init
```

Vous pouvez aussi lier le paquet avec `pnpm --dir packages/cli link --global` depuis ce dépôt pour disposer de la commande `memagent`. Le nom npm reste à vérifier avant publication.

```sh
memagent init
memagent add rule "Utilise pnpm, jamais npm"
memagent add decision "PostgreSQL pour le multi-tenant — voir ADR-003"
memagent add note "Refactor auth : reste les tests e2e"
memagent add note "Diagnostic personnel" --private --ttl 14d
memagent add rule "Commits en anglais" --global
memagent list
memagent list --private
memagent list --type note --expired
memagent remove <id>
memagent run
memagent run -- claude --model sonnet
```

`run` synchronise avant de lancer `claude` par défaut. La fraîcheur au démarrage est garantie en passant par cette commande ; un lancement direct de Claude ne déclenche pas MemAgent. Alias facultatif Bash/Zsh : `alias cc='memagent run'`. Sous PowerShell : `function cc { memagent run @args }`.

`run -- <exécutable> [arguments]` accepte également une commande personnalisée, sans interprétation shell. Sous Windows, fournissez un exécutable natif ; pour un script `.cmd`, utilisez explicitement `cmd.exe /c …`. La commande enfant conserve le dossier courant et son code de sortie est propagé. Si la synchronisation échoue, rien n'est lancé.

## Stockage et confidentialité

| Portée | Source | Destination Claude Code |
| --- | --- | --- |
| Projet, par défaut | `.memagent/memory.md` | `CLAUDE.md` |
| Projet privé, `--private` | `.memagent/memory.local.md` | `CLAUDE.local.md` |
| Personnel global, `--global` | `~/.config/memagent/memory.md` | `~/.claude/CLAUDE.md` |

`init` ajoute les deux fichiers privés au `.gitignore`. Les fichiers globaux restent dans le dossier utilisateur. `CLAUDE_CONFIG_DIR`, lorsqu'il est défini, remplace le dossier de destination `~/.claude`. `--global` et `--private` sont incompatibles. `list` et `remove` utilisent la même sélection de portée que `add` ; les opérations globales fonctionnent sans projet initialisé. Les opérations projet trouvent la mémoire depuis les sous-dossiers.

La mémoire partagée et son `CLAUDE.md` sont à committer ensemble. MemAgent ne crée aucun commit. Il rétablit les exclusions privées à chaque synchronisation projet et refuse d'écrire si l'un des deux fichiers privés est déjà suivi par Git. Retirez explicitement ces fichiers du suivi avant de réessayer : `.gitignore` ne protège pas un fichier déjà suivi. Git est facultatif pour les dossiers sans dépôt ; sans Git installé, cette vérification du suivi est indisponible.

Chaque entrée possède un ID, un type et une date de création. Les notes expirent après sept jours ; `--ttl 14d` et `--ttl never` modifient cette durée à la création. Une note expirée reste dans la source, mais disparaît du contexte à la prochaine synchronisation. `list` montre les entrées actives, `list --expired` les notes expirées. Aucun effacement automatique.

Les destinations sont gérées uniquement entre `<!-- memagent:start (généré, ne pas éditer à la main) -->` et `<!-- memagent:end -->`. Le reste est préservé. Les marqueurs absents entraînent l'ajout d'un bloc ; les marqueurs incomplets ou dupliqués provoquent une erreur avant écriture. Une synchronisation sans changement conserve les octets existants. Évitez les modifications manuelles du bloc généré ; les sources Markdown restent lisibles et éditables en conservant leurs métadonnées et marqueurs.

La hiérarchie souhaitée est privée-projet > partagée-projet > globale. Elle est formulée dans les blocs ; MemAgent ne détecte pas les contradictions et ne garantit pas l'obéissance du modèle. [Documentation officielle de la mémoire Claude Code](https://code.claude.com/docs/en/memory).

## Vérifier le scénario réel

1. Enregistrer les consignes pnpm, la décision PostgreSQL avec ADR-003 et une note de travail.
2. Lancer Claude via `memagent run` ; consulter `/memory` ou `/context all` pour vérifier les fichiers chargés.
3. Demander l'ajout d'une dépendance et un choix de stockage multi-tenant : vérifier pnpm et PostgreSQL/ADR.
4. Fermer et rouvrir pendant cinq sessions ; ne répéter aucune consigne enregistrée.
5. Sur un autre ordinateur, cloner les fichiers partagés et lancer `memagent run` avec MemAgent installé. Les souvenirs privés ne sont pas transférés.

Le chargement effectif et le comportement du modèle nécessitent Claude Code installé. Les tests automatisés couvrent le stockage, le routage, l'expiration, la préservation des fichiers et le CLI avec une commande enfant locale.

Le workflow GitHub Actions compile, vérifie les types et exécute les tests sous Linux et Windows avec Node.js 22 et 24. Les tests de protection du suivi nécessitent Git. Exécutez `pnpm build` avant `pnpm test` : les tests CLI utilisent le binaire compilé.

## Limites de cette version

Pas de MCP, de hook de démarrage, d'export Cursor/Aider, de SQLite, de recherche sémantique ni de synchronisation cloud. Pas de verrou entre processus : lancez une seule mutation MemAgent à la fois. Chaque écriture est atomique, mais la mise à jour de plusieurs fichiers n'est pas une transaction : après une panne disque ou interruption, relancez `memagent sync`.

L'initialisation et la synchronisation peuvent créer ou modifier le bloc global dans votre dossier utilisateur. Les tests utilisent exclusivement des dossiers temporaires. Le projet n'a pas encore de licence choisie ; une publication publique devra régler ce point.
