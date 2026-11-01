# Écran Persona du CRM, dans Créatrices (ID à donner)
Statut : in_progress (écran, API, création, activation et import d'un fichier ; reste l'historique des versions ; ID à valider par Charles)
Phase : 5 (éditeur de persona, ADR 0010), avancé par la revue 08, action 5
Dépend de : P0-08 (`PersonaSchema`), coquille `apps/web` (#34) ; pour l'API, la PR créatrices du fil Bilan (`GET /v1/creators`)
Branche : claude/persona-screen-jbetuh

## Objectif
Créatrices › Persona montre et édite la persona de la créatrice onglet par onglet, comme la fiche créatrice d'OnlyChat (Détails, Infos en plus, Comportement, Stratégies, Relances, Notifications), plus Limites, construite sur `packages/contracts/src/persona.ts` et non sur l'ancien prototype. Pas de réglage de négociation, curseurs dans les unités du schéma (heures, minutes, jours), mention « Règle stricte » sur ce que la politique et les gardes appliquent.

## Contexte à lire
`docs/reference/persona-schema.md`, ADR 0010 et 0012, `docs/design/README.md` (Hiérarchie, États), revue 08 §Persona (hors dépôt).

## À faire
- [x] Écran `apps/web/src/creators/persona/` : en-tête (version, état du brouillon, action unique), sept onglets, validation par `PersonaSchema` avec messages français, pastilles d'erreurs par onglet, blocs secondaires repliés derrière une ligne de synthèse.
- [x] Lecture derrière un seul hook (`usePersona`) ; tant que l'API n'existe pas, il lit `personas/messalina/v0.0.0.yaml` avec la pastille « Exemple » et le bouton « Enregistrer une version » reste désactivé.
- [x] Persona rangée dans l'onglet Créatrices (`/creatrices`, demande de Charles du 17/10 à 21h51), nom de la créatrice lu par `GET /v1/creators`, choix de la créatrice quand il y en a plusieurs.
- [x] Finitions : point néon sur chaque champ et onglet modifié, nombre de modifications dans l'en-tête, « Tout annuler », − / + sur les nombres, « Voir le premier » qui ouvre l'onglet, déplie le bloc et place le curseur dans le champ, panneau qui glisse du côté de l'onglet choisi, squelette au chargement, l'exemple `<à remplir>` remplacé à la première saisie.
- [x] Genre retiré de l'écran (Charles, 22h11 : Nirvana sert des créatrices) ; langues parlées en liste déroulante à choix multiples avec recherche.
- [x] Fuseau horaire en lecture seule : celui de la créatrice (`creators.timezone` via `GET /v1/creators`, décision du coordinateur et de Bilan), avec l'heure qu'il est chez elle.
- [x] API, après la fusion de la PR créatrices de Bilan, add-only sur le module `persona` (Bilan en relecture, ligne de composition-root à Bilan) : `packages/contracts/src/persona-api.ts` (`PersonaOverview`, `PersonaVersionSummary`, `CreatePersonaVersionBody`, objets stricts, `contentHash`), `GET /v1/creators/:creatorId/persona` et `POST /v1/creators/:creatorId/persona/versions` (contrôle d'accès de conversations, lecture en `withTenant`, 409 `persona_version_conflict`, jamais de version active : l'activation reste `pnpm persona:load --activate`).
- [x] L'écran lit la persona de la créatrice choisie ; la pastille « Exemple » disparaît, le bouton s'ouvre. La copie `details.timezone` envoyée au modèle est alignée sur `creators.timezone` à l'enregistrement ; les mots-clés d'alerte restent saisis ici, la page Telegram les lit. Enregistrer : propriétaire et créatrice seulement (les chatteurs lisent), numéro suivant calculé par l'écran (0.0.1 au-dessus du plus haut), 409 si une autre version est arrivée entre-temps.
- [x] `pnpm persona:load <fichier> [--creator <id>] [--activate]` et `pnpm persona:validate <fichier>` (demande du coordinateur, relecture Bilan) : chargement idempotent, une seule version active, audit.
- [x] Recette du 19/10 (A-13, A-14) : les `<à remplir>` de l'exemple ne s'affichent plus comme des valeurs (champ vide « À remplir », étiquettes masquées) et ne sont jamais enregistrés ; « Écris comme le fan… » dans le Playground.
- [x] Créer une créatrice et activer une version depuis l'écran Créatrices (demande de Charles relayée le 19/10, la CLI ne suffit pas) : `POST /v1/creators` (propriétaire) et `POST …/persona/versions/:versionId/activate` (propriétaire et créatrice), ajout seul, Bilan en relecture. Le retour du verrou d'Automatique au changement de version active est porté par Bilan (R-G3, ADR 0019).
- [x] « Importer un fichier » (« oui » de Charles du 01/11 au brouillon de la persona) : le propriétaire ou la créatrice choisit un fichier YAML de persona écrit hors de Nirvana, jamais dans le dépôt (ADR 0010). Le fichier est lu dans le navigateur par `PersonaSchema` et remplace ce qui est à l'écran, champ par champ, comme une saisie : rien n'est envoyé avant « Enregistrer une version », la version enregistrée reste inactive jusqu'à son activation, et la version active ne bouge pas. Le fichier devient celui de la créatrice de l'écran (`meta.creator`) et garde son numéro s'il vient après toutes ses versions (sinon le suivant). Bouton seulement quand rien n'attend à l'écran ; un fichier refusé dit combien de problèmes, le premier sous son onglet et sa clé YAML, et rien ne change. Le mot « brouillon » est celui de la réponse de l'agent (glossaire) : l'écran dit « fichier ».
- [ ] Historique des versions et comparaison (ADR 0010), plus tard.

## Critères d'acceptation
- `pnpm check` et `pnpm test` verts ; règles de l'écran testées (onglets, messages, synthèses, exemple valide).
- Rendu à 1 440 px et 400 px sans débordement horizontal.
- Aucune vraie donnée de la créatrice dans le dépôt ni dans une page hébergée (ADR 0010).
