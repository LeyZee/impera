# VEI-01 Signaux de tendance et idées de contenu : la base, les filtres, le lien collé
Statut : todo
Phase : veille (ADR 0060)
Dépend de : CR-05 (suggestions de l'agenda), CR-06 (demande de contenu)
Branche : task/vei-01-trend-signals
Propriétaire : Bilan (contrats, base, module, routes)

## Objectif
Les signaux de tendance et les idées de contenu existent en base, avec les filtres du code, et un membre de l'agence peut déjà coller un lien repéré sur Instagram.

## Contexte à lire
ADR 0060 (tout), ADR 0042 § 4, ADR 0055 § 1 et § 4, ADR 0056 § 1 (filtre des dégoûts), ADR 0057 § 6 (garde Instagram), ADR 0010.

## À faire
- [ ] Contrats Zod dans `packages/contracts` : `trend_signal` (source parmi les six de l'ADR 0060 § 2, texte, lien, format, chiffres, péremption), `content_idea` (catégorie de dépôt, à tourner, signal d'origine, raison, temps estimé, état : proposée, validée, refusée, suggérée, déposée).
- [ ] Migration (prochain numéro libre au moment du lot) : signaux, idées, motif de refus, lien idée → dépôt ; RLS de l'agence ; la créatrice ne lit rien de ces tables.
- [ ] Module feuille (domaine pur) : péremption, filtres de l'ADR 0060 § 4 (dégoûts et limites, proximité sur 30 jours, refusée jamais reproposée, garde des sorties publiques, signal vivant requis).
- [ ] Route « coller un lien » pour l'agence et pour la créatrice : lien Instagram validé (domaine, forme), une ligne, un format, une créatrice visée ; jamais de téléchargement.
- [ ] Route d'entrée des relevés de l'extension (VEI-02) : schéma strict, idempotente sur le lien du post et la session de veille.
- [ ] Idée validée → suggestion de l'agenda (ADR 0042 § 4) ; suggestion acceptée → demande de contenu (ADR 0055 § 4).
- [ ] Plafond de budget propre à la veille (ADR 0060 § 7) dans la passerelle LLM, réglage du propriétaire.
- [ ] Glossaire déjà à jour (ADR 0060) ; ajouter un terme seulement si le lot en impose un.

## Critères d'acceptation
- Tests du domaine pour chaque filtre, avec une créatrice fictive.
- Tests d'intégration : RLS (la créatrice ne lit ni signal ni idée), idempotence des relevés, péremption.
- Aucune donnée réelle (lien, nom de compte) dans les tests.

## Hors périmètre
La génération des idées (VEI-03), l'écran « Idées du jour » (VEI-02), le profil de contenu (VEI-04).

## Notes de session
