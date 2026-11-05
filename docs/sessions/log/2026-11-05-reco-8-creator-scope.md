# 2026-11-05 — Reco 8 de la recette : un manager ne touche que ses créatrices, partout

Fait :
- `requireRole` (`apps/api/src/auth.ts`) refuse en 403 `creator_forbidden` toute route dont le chemin nomme `:creatorId` à un `operator` qui ne l'a ni dans `creatorIds` ni, chatteur, dans `routedCreatorIds` : dépôts, demandes, idées, file de scripts compris ;
- `api.md` le dit ;
- les tests de `content-drops`, `content-drop-uploads`, `trend-ideas`, `script-structures` donnent leurs créatrices aux membres d'équipe, et vérifient le refus d'un manager d'une autre créatrice.

Décisions :
- la garde est centrale plutôt que route par route : une route ajoutée plus tard est couverte d'office ;
- un chatteur passe la garde pour une créatrice qui lui est routée, et la route garde son propre refus (`content_idea_forbidden`, `content_drop_forbidden`).

Découvertes :
- aucune.

Vérifié :
- intégration `content-drops`, `trend-ideas`, `script-structures`, puis toute la suite d'intégration de l'API (`content-drop-uploads` demande Docker : par la CI).
