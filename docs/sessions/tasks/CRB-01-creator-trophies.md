# CRB-01 Trophées et médailles de série de la créatrice
Statut : todo
Phase : créatrice (ADR 0107 ; ADR 0042 § 3, ADR 0055 § 4, ADR 0104 § B)
Dépend de : ADR 0107 (acceptée le 13/11/2026) ; la PR du jeu du chatteur (module `rewards`, migration 0178) ; PR #720 et PR des médailles du chatteur (composant de dévoilement et langage graphique partagés) ; un numéro de migration attribué par le coordinateur
Branche : claude/project-thread-vnzrdd
Propriétaire proposé : le fil « Récompenser la créatrice avec des badges » ; relecteurs Design/UX (écrans, dessins), Bilan (base, job), Médias (dépôts et demandes)

## Objectif (1 phrase)

La créatrice gagne des médailles à chaque palier de sa série de journées réussies et des trophées pour ses dépôts et ses demandes livrées à l'heure, avec le dévoilement du chatteur, sans que le jeu touche jamais l'argent ni ne lui reproche un refus.

## Contexte à lire (fichiers précis)

- ADR 0107 (toutes les règles), ADR 0104 § B, ADR 0042 § 3 et § 7, ADR 0055 § 4 à § 6.
- `apps/api/src/modules/creator-tasks/domain/streak.ts` (série de journées), `packages/db/src/schema/content-drops.ts` (`content_requests`, `content_drops.request_id`).
- `apps/web/src/screens/agenda/DayView.tsx` (série affichée à côté de sa journée), `apps/web/src/screens/me/`.

## À faire (liste vérifiable)

- [ ] Domaine pur et testé : série de livraisons (§ 2), constat des neuf trophées (§ 3), médaille du palier atteint (§ 1).
- [ ] Migration 0181 dans le module `rewards` : types de la créatrice ajoutés à la liste fermée de la table commune des gains, politiques RLS de la créatrice, test RLS (elle lit les siens et marque un dévoilement vu ; l'agence lit ; un chatteur ne lit rien). Pas de seconde table. Relecture Bilan (13/11) : politiques rattachées au compte du gain ; lecture agence limitée aux rôles propriétaire et manager actif ; GRANT UPDATE de la seule colonne du dévoilement vu au rôle applicatif, sur la ligne de son compte, ni autre UPDATE ni DELETE ; INSERT à `impera_service` (après #716) vérifié par le test des droits ; job en ON CONFLICT DO NOTHING.
- [ ] Job rejouable : après une coche, après un dépôt arrivé, chaque nuit dans son fuseau.
- [ ] Route de la vitrine au harnais d'isolation ; test « une créatrice ne lit pas les trophées d'une autre ».
- [ ] Écrans : médaille à côté de la série, « Mes trophées » dans Moi, dévoilement partagé avec le chatteur, lecture sur sa fiche côté agence.
- [ ] Symboles de la créatrice dessinés dans le langage des médailles du chatteur, rendus en grand et à 24 à 40 px, Nuit et Jour, validés par Charles.
- [ ] Glossaire : élargir « Trophée » à la créatrice une fois #720 fusionnée.
- [ ] Captures Nuit/Jour, PC/téléphone validées avant fusion.

## Critères d'acceptation

`pnpm check`, `pnpm test:all` verts ; refuser une demande avant son échéance ne casse pas la série ; rejouer le job ne donne rien deux fois ; aucune notification envoyée par le jeu.

## Hors périmètre

Niveaux, primes, trophées sur les ventes ou les gains, classement entre créatrices.

## Notes de session
