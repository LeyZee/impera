# Module `audit`

**Rôle.** Le journal d'audit lisible par le propriétaire (EQ-18, ADR 0024 : Réglages › Journal) : qui a fait quoi dans le CRM, la ligne la plus récente en haut, chaque geste dit en français. Le lot a est le serveur ; l'écran est le lot b, la conservation (dix ans pour l'argent, purge par un job nommé) le lot c.

**Peut dépendre de.** aucun module métier (feuille).

**Tables.** Ne possède aucune table. Lit `audit_log` (ajout seul, hors RLS, écrit par tous les modules) sur la connexion de service (`withAdmin`, `packages/db/README.md`), et, en lecture seule, les noms qu'il affiche : `team_members.display_name` (l'auteur et les membres nommés), `user.name` (un auteur sans fiche de membre, le propriétaire), `creators.display_name`. Écrit une seule ligne dans `audit_log` : `audit.export`, quand le propriétaire exporte le journal (combien de lignes, jamais la sélection elle-même).

**Le contrat** (`packages/contracts/src/audit.ts` et `audit-actions.ts`) :

- chaque `action` que le code écrit a un schéma Zod de ses `details`, une catégorie (`money`, `team`, `access`, `agent` : Argent, Équipe, Accès, Agent) et sa phrase en français (« a changé le taux de Nora à partir du 1er novembre 2026 ») ; les appels d'outils MCP (`mcp.<outil>`) forment une famille ;
- un schéma ne garde que les champs qu'il nomme, et chaque texte qu'il garde est un code borné, un identifiant, un jour ou un instant : un test parcourt tous les schémas et refuse un nom de champ qui dit un secret, un jeton, un mot de passe, une adresse (IP, e-mail, URL), le contenu d'un message ou d'une pièce, ou un texte libre ;
- une action inconnue, ou des `details` que son schéma refuse, s'affichent telles qu'écrites (le nom de l'action), sans leurs détails, jamais en erreur ;
- la catégorie d'une action inconnue vient de son premier mot (`invoice…`, `pay…`, `commission…` : argent ; `auth.` : accès), sinon `team` ; Postgres calcule la même (un `case` construit depuis le registre), et le test d'intégration vérifie que les deux s'accordent sur chaque action ;
- le lien d'une ligne (`statement`, `invoice`, `member`, `creator`, `shift`) vient de son entité, ou de ses détails quand l'entité n'en est pas un (une pièce du dossier ouvre le membre).

**Routes** (montées sous `/v1`, propriétaire seul par `requireRole('owner')`, jamais en cache) :

- `GET /audit?userId=&category=&from=&to=&limit=&cursor=` → `AuditPageSchema` : `limit` 50 par défaut, 200 au plus ; `from` inclus, `to` exclu (instants ISO avec décalage) ; le curseur est la place de la dernière ligne dans `(created_at, id)`, `created_at` à la microseconde : une ligne écrite pendant la lecture arrive avant la première page, jamais dans les suivantes. 400 `audit_cursor_invalid` pour un curseur que ce serveur n'a pas donné.
- `GET /audit.csv?userId=&category=&from=&to=` : la même sélection, toutes ses lignes (20 000 au plus, sinon 422 `audit_export_unprocessable`, `details.max`), en CSV : point-virgule, CRLF, UTF-8 avec BOM, chaque cellule entre guillemets, et une cellule qui commence par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot prend une apostrophe (injection de formule). La date est en UTC.

**Limites connues.** `created_at` est l'heure du début de la transaction qui écrit : une transaction longue qui valide après qu'une page a été lue peut écrire une ligne plus ancienne que le curseur, que cette lecture ne montre pas (une nouvelle lecture la montre). Aucun index sur `user_id` ni sur `action` : le lot c, qui touche la table, en jugera.

## Structure

- `domain/` : les ports, les erreurs, le CSV. Zéro I/O.
- `application/` : la page et l'export.
- `infra/` : la lecture Drizzle par `withAdmin`, le curseur, les routes Fastify.
- `index.ts` : **seule** porte d'entrée publique du module.

Voir `docs/architecture/modules.md` pour les règles communes.
