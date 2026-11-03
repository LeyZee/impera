# 0062. Le projet s'appelle Impera : un renommage mécanique, en une PR, dans une fenêtre de gel

Statut : proposed (demande de Charles du 03/11/2026, 11 h 37 : « j'aimerais bien qu'on renomme le projet, donc il faudrait renommer partout, sur toute l'extension, partout où ça apparaît […] pourquoi pas Impera, donc I-M-P-E-R-A, comme le nom de mon agence » ; fil « Renommer Nirvana en Impera »). À accepter par « ok 0062 ».
Date : 2026-11-03
Précise : aucune ADR n'est remplacée. Les ADR passées gardent le mot « Nirvana » : elles sont immuables et disent ce qui a été décidé, sous le nom de l'époque.

## Contexte

Le produit porte le nom « Nirvana » depuis le 16/10. Charles ne s'y reconnaît pas : le produit sert son agence, IMPERA Agency, et il veut qu'il en porte le nom (en latin, *impera* : « commande », à l'impératif). Le design system reste tel quel ; seul le logo s'adapte (§ 6).

Inventaire au 03/11, sur `main` (75c5168) : **1 253 fichiers suivis, 2 456 lignes** contiennent « nirvana », toutes casses confondues.

| Où | Fichiers | Nature |
|---|---|---|
| `apps/api` | 569 | Surtout les imports `@nirvana/*` ; puis l'en-tête `x-nirvana-client-ip`, l'émetteur TOTP, le `PRODID` du flux agenda, les variables `NIRVANA_*`, des valeurs de test |
| `apps/web` | 280 | Imports `@nirvana/*`, textes affichés (« Chargement de Nirvana », « Installer Nirvana »), clés `localStorage` (`nirvana.appearance`, `nirvana.followed-creator`, `nirvana.suivi.order`, `nirvana.install.refusals`), caches du service worker (`nirvana-shell-*`, `nirvana-assets-*`), manifeste PWA, `nirvana-mark.svg` |
| `packages/db` | 157 | 40 migrations appliquées citent les rôles `nirvana_app` et `nirvana_admin` ; `init.sql` ; le nom de base `nirvana` ; la valeur de plateforme `'nirvana'` dans dix contraintes `CHECK` ; la version de moteur de paie `nirvana-N` |
| `packages/*` (autres) | 31 | Noms de paquets `@nirvana/contracts`, `db`, `llm`, `design-system` ; enum `PlatformSchema` (`'nirvana'`) |
| `apps/extension` | 7 | Nom du manifeste WXT, titre et marque du popup, `mark.svg`, `package.json` |
| `brand/` | 8 | `nirvana-mark.svg`, `nirvana-lockup*.svg`, bannière, favicon, README |
| Racine, CI, ops | 10 | `package.json`, `turbo.json`, `pnpm-lock.yaml`, `docker-compose*.yml` (conteneur, volume, image `nirvana-api`, bucket `nirvana-media`), `.env.example`, `ci.yml`, `ops/db-export` (`nirvana.dump`, `nirvana-<date>.tar.age`), `.gitleaks.toml`, `NIRVANA_ALLOW_MAIN_PUSH` du hook `protect-main` |
| Docs vivantes | 22 | `CLAUDE.md`, `README.md`, `00-START-HERE.md`, architecture, conventions, runbooks, référence, design, glossaire, roadmap |
| Historique | 155 | 28 ADR, 127 fichiers de `docs/sessions/` (journal et fiches), `brainstorm/` |

Le préfixe CSS `nv-` (jetons `--nv-*`, classes `nv-*`) vient aussi de « Nirvana » : **6 389 occurrences** dans `apps/` et `packages/`.

Cinq PR sont ouvertes (#382, #409, #459, #463, #464) et six fils codent en parallèle. Un renommage touche presque chaque fichier de code par ses imports : fait en même temps que d'autres PR, il les met toutes en conflit.

## Décision

### 1. Ce qui se renomme

| Avant | Après |
|---|---|
| « Nirvana » affiché partout (web, PWA, extension, popup, TOTP, passkeys, flux agenda, Telegram, e-mails, textes d'aide) | « Impera » |
| `@nirvana/*` (paquets et imports) | `@impera/*` |
| `NIRVANA_*` (variables d'environnement, dont `NIRVANA_ALLOW_MAIN_PUSH`) | `IMPERA_*` |
| `x-nirvana-client-ip` | `x-impera-client-ip` |
| Valeur de plateforme `'nirvana'` (notre future plateforme) | `'impera'`, par une migration nouvelle (§ 3) |
| Clés `localStorage` `nirvana.*` | `impera.*`, avec une lecture de l'ancienne clé une fois puis sa suppression, pour que personne ne perde son thème ni ses réglages |
| Caches du service worker `nirvana-*` | `impera-*` ; le nettoyage existant supprime aussi les anciens noms |
| Nom de base `nirvana`, conteneur `nirvana-postgres`, image `nirvana-api`, bucket `nirvana-media`, fichiers `nirvana.dump` et `nirvana-<date>.tar.age` | `impera`, `impera-postgres`, `impera-api`, `impera-media`, `impera.dump`, `impera-<date>.tar.age` ; la vérification de restauration lit les deux préfixes d'archive |
| `brand/nirvana-*.svg`, `apps/web/public/nirvana-mark.svg` | `brand/impera-*.svg`, `impera-mark.svg` (§ 6) |
| `NirvanaPlatformConnector` (cité dans les docs) | `ImperaPlatformConnector` |
| Nom annoncé par le serveur MCP (`nirvana-mcp`, ADR 0026) | `impera-mcp` ; les agents déjà connectés n'ont rien à refaire |
| Docs vivantes (liste ci-dessus), `CLAUDE.md`, README des modules | « Impera » |

### 2. Ce qui reste, et pourquoi

1. **Les rôles Postgres `nirvana_app` et `nirvana_admin`.** Quarante migrations appliquées leur donnent des droits par leur nom. Une migration appliquée ne se modifie pas, et une base neuve rejoue toutes les migrations : renommer les rôles casserait toute installation neuve. Ce sont des noms techniques que personne ne voit ; le glossaire le dit.
2. **La version de moteur de paie `nirvana-N`.** Elle est écrite dans chaque relevé de commission, et un relevé validé doit se recalculer à l'identique (ADR 0023). Les relevés existants la gardent, et les versions suivantes gardent ce préfixe, que la contrainte de la migration 0028 impose. C'est un identifiant de version, pas une marque.
3. **L'historique** : les ADR 0001 à 0061, `docs/sessions/log/`, les fiches terminées de `docs/sessions/tasks/`, `brainstorm/` et l'historique git. Le glossaire porte une ligne « Nirvana : ancien nom d'Impera, jusqu'au 03/11/2026 ». Les fiches encore ouvertes sont renommées.
4. **Le préfixe CSS `nv-`.** 6 389 occurrences, invisibles pour l'utilisateur, dans les fichiers où travaillent Extension et Chantier 7. Il reste `nv-` dans la PR de renommage ; il passera à `im-` dans la passe de peaufinage du design system, qui touchera ces fichiers de toute façon. Le design system ne change pas d'un pixel.
5. **L'URL du dépôt `github.com/LeyZee/nirvana`.** Renommer le dépôt est un geste de Charles dans les réglages GitHub (Settings → General → Repository name). GitHub redirige l'ancienne URL, les clones et les PR ouvertes continuent de marcher. Les docs citent la nouvelle URL une fois le dépôt renommé, dans une PR d'une ligne.
6. **Le dossier local** `C:\Users\USER\Downloads\Projet Nirvana` : à renommer par Charles, Claude Code fermé, après la fusion ; les dossiers approuvés et le Remote Control se réapprouvent sur le nouveau chemin. Rien dans le dépôt ne dépend de ce chemin.

### 3. Base de données

- Migration nouvelle (numéro attribué par le coordinateur à l'ouverture de la PR) : les dix contraintes `CHECK` de plateforme acceptent `'impera'` au lieu de `'nirvana'`, et met à jour les lignes qui porteraient `'nirvana'` (aucune aujourd'hui : notre plateforme n'existe pas). Générée par drizzle-kit, jamais écrite à la main.
- Nom de base : `docker-compose.yml`, `.env.example`, `init.sql` et la CI passent à `impera`. La base de dev déjà créée sur le PC de Charles garde ses données : `ALTER DATABASE nirvana RENAME TO impera` (réversible), lancé par la session Remote Control avec son accord, et le volume Docker garde son nom réel par `name: nirvana-pgdata`. Rien n'est déployé : aucune base de production à toucher.

### 4. Comment : un script, une PR, une fenêtre de gel

1. Le renommage est un **script** (rename-impera.mjs, dans le dossier des scripts), idempotent, relu dans la PR : il applique les tables du § 1, laisse ce que liste le § 2, régénère `pnpm-lock.yaml` (aucune dépendance nouvelle : pas de quarantaine) et refuse de finir si `pnpm check` ou `pnpm test` est rouge.
2. **Une seule PR**, pas des lots : un import `@impera/*` ne compile pas tant que le paquet s'appelle `@nirvana/*`, donc des lots laisseraient `main` dans un état mixte, et chaque lot demanderait son propre gel. Une PR, un gel.
3. **Fenêtre de gel** convenue entre Charles et le coordinateur, environ 2 heures : les fils fusionnent ce qui est prêt ou mettent leur PR de côté ; à l'heure dite, le script tourne sur `main` à jour, la PR passe la CI, Bilan et Extension relisent, elle est fusionnée. Le gel se lève à la fusion.
4. **Après la fusion**, chaque branche en vol lance le même script sur elle-même, commite, puis se rebase sur `main` : les conflits de nom disparaissent, il ne reste que les vrais conflits. Le script est supprimé du dépôt deux semaines après, une fois toutes les branches passées.
5. Le logo (§ 6) est une PR à part, après, qui ne touche que `brand/`, les icônes et le design system ; elle n'a pas besoin de gel.

### 5. Relectures

Bilan (db, server, contrats, CI, ops), Extension (apps/web, extension, design system), Agent (textes de la persona et des prompts : le bot ne nomme jamais l'outil devant un fan, rien ne change pour eux), Équipe (paie : vérifier que `nirvana-N` reste intact).

### 6. Le logo

Le logo d'Impera part du logo de l'agence IMPERA, fourni par Charles, redessiné dans le design system actuel : palette Nuit et Jour (néon `#ff2a4d` / `#cc0029`, `void` `#07060a`, `ink` `#f6eef1`), lumière unique, wordmark en italique serif comme aujourd'hui. Livrés dans `brand/` : marque couleur et mono, favicon, lockups Nuit, Jour et mono, bannière README ; dans les apps : icônes de l'extension (16, 32, 48, 128), icônes PWA (192, 512, maskable), favicon et en-tête du web. Chaque variante est rendue en PNG et regardée en grand et à 16-32 px avant d'être montrée. Charles valide sur planche avant la PR.

## Conséquences

- Positives : le produit porte le nom de l'agence, partout où un humain le voit ; un seul gel ; le script rend le rattrapage des branches mécanique.
- Négatives : environ deux heures sans fusion ; une PR énorme à relire (mais mécanique : la relecture porte sur le script et sur le § 2) ; les noms `nirvana_app`, `nirvana_admin` et `nirvana-N` restent dans la base pour toujours.
- À surveiller : les extensions déjà chargées sur un poste prennent le nouveau nom au rechargement ; les applis d'authentification gardent l'ancien libellé « Nirvana » pour un compte déjà enrôlé (le code reste valide, le libellé se change à la main ou au prochain enrôlement) ; les passkeys restent valides (elles dépendent du domaine, pas du nom).

## Alternatives rejetées

- **Renommer par lots** (paquets, puis web, puis docs) : état mixte sur `main`, un gel par lot, cinq fois plus de rebases.
- **Renommer aussi les rôles Postgres** : casse toute installation neuve, ou oblige à modifier des migrations appliquées.
- **Renommer le préfixe `nv-` maintenant** : triple la taille de la PR et les conflits avec Extension et Chantier 7, pour un nom que personne ne voit.
- **Renommer au fil de l'eau, sans gel** : chaque PR ouverte se retrouve en conflit sur des centaines de fichiers.
