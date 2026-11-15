# 15/11/2026 : la ligne « Disponible » et la porte au playground

- **Fiche** : ADR 0103, amendement du 13/11, § 14 (fil Playground).
- **Fait** : sous chaque note de désir de ses messages, et dans « Pourquoi » sous la jauge, le playground dit sa disponibilité (confirmée, inconnue, non) avec ce qui l'a fixée, s'il sexualise lui-même, si elle lui a demandé s'il est tranquille, et la porte avant le premier teaser : ouverte, ou les conditions qui manquent. Le serveur calcule tout (agent/domain/availability.ts, branché par #738) ; contrat `PlaygroundAvailabilitySchema` dans `PlaygroundDesireSchema`. La démo lit quelques mots pour montrer la même chose.
- **Tests** : session (porte fermée puis ouverte), route (libellés français), écran (ligne repliée, détail, « Pourquoi »).
- **Reste** : ventes fictives avec l'horloge simulée « Passer au lendemain » (aussi pour le jeu des cœurs, ADR 0111 § 14 bis), écran « Leçons », conversations gardées en base.
- **Découvertes** : aucune.
