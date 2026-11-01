# ADR : décisions d'architecture

Une ADR (Architecture Decision Record) fige une décision structurante avec son contexte, pour qu'une session future ne la rouvre pas sans savoir pourquoi elle a été prise.

## Règles

- Une ADR est **immuable** une fois `accepted`. Pour changer d'avis : nouvelle ADR qui `supersedes` l'ancienne (l'ancienne passe en `superseded`).
- Statuts : `proposed` (une session Opus peut en créer une) → `accepted` (Charles ou la session d'architecture) → `superseded` / `rejected`.
- Numérotation séquentielle à 4 chiffres, nom `NNNN-slug.md`.
- Une session de code qui prend une décision structurante non couverte **doit** créer une ADR `proposed` et le dire dans sa fiche de tâche. Elle ne doit pas passer outre une ADR `accepted`.

## Gabarit

```
# NNNN. Titre
Statut : proposed | accepted | superseded by NNNN | rejected
Date : AAAA-MM-JJ
## Contexte
## Décision
## Conséquences (positives, négatives, à surveiller)
## Alternatives rejetées
```

## Index

| N° | Titre | Statut |
|---|---|---|
| 0001 | TypeScript, monorepo pnpm + Turborepo | accepted |
| 0002 | Monolithe modulaire, frontières vérifiées par ESLint | accepted |
| 0003 | Cœur agnostique de la plateforme (y compris notre future plateforme sans abonnement) | accepted |
| 0004 | Fastify plutôt que NestJS | accepted |
| 0005 | Postgres + Drizzle + RLS par `creator_id` | accepted |
| 0006 | Graphile Worker, une file série par conversation | accepted |
| 0007 | Journal d'événements de conversation comme source de vérité | accepted |
| 0008 | Port `PlatformConnector` ; Reveal via session capturée et client API serveur | accepted |
| 0009 | Passerelle LLM unique, trois rôles, règles métier dans le code | accepted |
| 0010 | Persona = donnée versionnée (YAML + schéma Zod), pas du code | accepted |
| 0011 | Argent en unités mineures entières ; identifiants UUID v7 typés | accepted |
| 0012 | `identity_policy` configurable, défaut `stay_in_character` | superseded (0021) |
| 0013 | Code en anglais, documentation, UI et persona en français | accepted |
| 0014 | Politique d'hygiène du dépôt | accepted |
| 0015 | Design system partagé dans `packages/design-system` | accepted |
| 0016 | Clés des fournisseurs IA saisies dans le dashboard, chiffrées en base | accepted |
| 0017 | Vision : Gemini en natif, bascule sur Grok en images clés | accepted |
| 0018 | Port connecteur étendu : scripts natifs, notes, coffre, médias, garde d'écriture | accepted |
| 0019 | Deux taux (au playground, en réel) et la règle qui ouvre le mode Automatique | accepted |
| 0020 | Notifications Telegram : bots, groupes et routage gérés depuis le CRM | proposed |
| 0021 | Rester en personnage est fixé dans le code, sans réglage | accepted |
| 0022 | La persona fait partie de la version qui ouvre l'Automatique | accepted |
| 0023 | La gestion d'équipe entre dans Nirvana : planning, rapports, paie, routine des créatrices | accepted (§ Navigation remplacé par 0024, gardes du chatteur par 0025, congés par 0031) |
| 0024 | Rôles et navigation : chacun ne voit que ce qui le concerne | accepted (Suivi du chatteur remplacé par 0025) |
| 0025 | Le chatteur chatte dans Reveal ; dans Nirvana, il traite sa créatrice pendant son shift, et rien hors shift | accepted |
| 0026 | Serveur MCP de Nirvana : une seconde porte sur les mêmes commandes | accepted |
| 0027 | Mise en production : deux images, un compose Coolify, un limiteur partagé en Postgres | accepted |
| 0028 | Export quotidien chiffré de la base, hors de Neon | accepted (§ 1 outils et § 2 `--no-privileges` remplacés par 0029) |
| 0029 | L'export garde les droits de la base, et s'outille sans binaire hors d'Alpine | accepted |
| 0030 | Médiathèque : un média, ses liaisons par plateforme, le coffre fait foi | accepted |
| 0031 | Congés et échanges de shift : le congé appartient au membre, l'échange se fait entre chatteurs | accepted (remplace en partie 0023 : congés) |
| 0032 | Paie : la quinzaine se clôture pour toute l'équipe à sa première validation | accepted (complète 0023 § Paie) |
| 0033 | Paie : le taux dollar → euro vient de la BCE, lu chaque heure par un job | accepted (complète 0023 § Paie et 0032) |
| 0034 | Le test à l'aveugle est une séance : le serveur calcule le taux, à partir de 40 situations | proposed (complète 0019 ; exception à 0023 à valider) |
| 0035 | Paie : une saisie verrouille sa quinzaine et chacune des suivantes | accepted (complète 0032 § Verrous) |
| 0036 | Factures : ce qu'une quinzaine doit rendre devient un avoir sur une facture déjà émise | accepted (précise 0023 § Factures) |
| 0038 | Paie : un petit montant est reporté deux fois au plus, pour que chaque facture soit payée avant son échéance | accepted (remplace dans 0023 le report sans limite d'un montant positif ; 0037 réservée au PDF des factures) |
