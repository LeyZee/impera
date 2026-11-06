# CR-15 Qui sont tes fans : les chiffres de sa base, tirés de leurs faits déclarés
Statut : review, ADR 0074 acceptée le 06/11/2026 à 14h48 (« ok 0074 ») ; code en PR, reste la validation des captures par Charles
Phase : espaces (ADR 0042, 0063, 0065)
Dépend de : CR-02 (lot c3, Ventes › Tes fans), ADR 0063 § 2, ADR 0065 § 2 à § 5, ADR 0074
Branche : celle de la session qui la prend (une session = sa branche)

## Objectif
En tête de Ventes, la créatrice voit qui sont ses fans en chiffres, jamais un fan seul : âge, région, famille de métiers, situation, et les chiffres de l'ADR 0065 § 3 (nouveaux, actifs, part qui débloque, panier moyen, répartition des dépenses, quand ils écrivent).

## Contexte à lire
ADR 0063, 0065, 0074 ; `packages/contracts/src/fans.ts` (`KycSlotSchema`) ; `apps/api/src/modules/fans/domain/facts.ts` (faits actifs, `normalizeKey`) ; `apps/api/src/modules/conversations/infra/http/creator-routes.ts` (chemin de lecture de la créatrice) ; `apps/api/src/__tests__/tenant-isolation.integration.test.ts` (harnais d'isolation) ; `docs/design/README.md`.

## À faire
- [x] Domaine `fans` : rangement pur (âge, région, famille de métiers, situation) avec ses tables, tests unitaires sur des valeurs inventées.
- [x] Contrat Zod `strict` des chiffres (parts par case, totaux arrondis, étiquettes fixes, aucun compte exact), dans `packages/contracts`.
- [x] `GET /v1/creator-space/fan-insights` sous RLS, chiffres arrêtés à minuit dans son fuseau, seuil de 10 et « Autres » sous 3 appliqués par le serveur ; déclarée au harnais d'isolation.
- [x] Écran : panneau « Qui sont tes fans » au-dessus de « Tes fans », anneaux et barres animés, survol et toucher, mouvement réduit, Nuit et Jour, ordinateur et téléphone.

## Critères d'acceptation
- Intégration : une créatrice ne lit que ses chiffres ; un fait inféré, une note de chatteur, un fait remplacé ou expiré, un fan à l'âge contesté ne comptent pas ; un bloc sous 10 fans ne rend aucun nombre ; aucune case ne rend son nombre de fans ; un fait écrit, remplacé ou expiré aujourd'hui ne change rien avant demain.
- Contrat : la réponse ne porte aucune valeur écrite par un fan ; un champ de trop la fait échouer.
- Finition : captures Nuit et Jour, téléphone et bureau, montrées à Charles avant fusion.

## Hors périmètre
- Une vue des mêmes chiffres pour le propriétaire.
- Une photo quotidienne en table (ADR 0074, conséquences).
