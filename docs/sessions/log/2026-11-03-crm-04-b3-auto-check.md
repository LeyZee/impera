# 2026-11-03 · CRM-04 lot b3 : vérification automatique des ventes (Bilan)

- Fiche : CRM-04, lot b3, convenu avec Équipe et Telegram (précisions a à e d'Équipe).
- Fait :
  - migration 0092 : `sales_feed_mismatch` dans les CHECK des types d'événements, et index unique `domain_events_sales_feed_mismatch_unique` sur (plateforme, quinzaine) ;
  - contrat de l'événement et du job `connector.check_sales` ;
  - `domain/auto-check.ts` (`fortnightBefore`, `mismatchDays`) ;
  - `buildReport`, partagé entre la vérification de Réglages et le job ;
  - `autoCheck`, avec seconde lecture à 24 h (`recheckLater`, `job_key`) et `publishMismatch` (`onConflictDoNothing`) ;
  - `salesCheckReads` dans `scheduling` (domaine `detectedForCheck`) ;
  - crontab les 2 et 17 à 6 h UTC ;
  - règle des numéros de migration écrite dans `packages/db/README.md`.
- Vérifié :
  - tests unitaires des deux fonctions de domaine ;
  - test d'intégration contre FakeReveal : rien quand les nets concordent, une seule seconde lecture même rejouée, rien si l'écart s'est résorbé, un seul événement sans créatrice ni fan ni chatteur, rien dans `sales_feed_checks` ;
  - test statique : la paie, le planning, les prestataires et la facturation ne nomment pas l'événement.
- Reste : le rendu Telegram de l'alerte (fil Telegram) ; `connection_state_changed` (migration 0087).
- Découvertes : aucune.
