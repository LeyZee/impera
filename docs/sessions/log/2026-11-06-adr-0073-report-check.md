# 2026-11-06 — ADR 0073 proposée : le rapport déclaré face aux ventes lues de Reveal

Fait :
- `docs/adr/0073-declared-reports-checked-against-reveal-sales.md`, statut `proposed`, et sa ligne dans l'index.
- Elle écrit les réponses de Charles du 06/11 : « ok rapprochement » (pas de Telegram au renvoi), puis « ok auto ».
  - Seuil : 1 % ou 5 €, réglable.
  - Validation automatique dans le seuil quand le rapport n'est pas au-dessus de Reveal.
  - Au-delà, ou au-dessus de Reveal : la validation attend que le chatteur corrige ou explique, 48 h au plus, puis le manager tranche.
  - Jamais de retenue automatique.
- Elle remplace, pour un compte Reveal en source « déclarée », le contrôle de l'ADR 0043 § 4 (5 % et 10 €, rapprochement ligne par ligne).
- Relecture de Bilan (#601) intégrée le jour même :
  - la comparaison n'est complète que quand le registre a été lu jusqu'au bout après la fin du shift (curseur `sales_feed_cursors`), pas seulement à l'horloge ;
  - le job valide la version qu'il a comparée, avec une clé idempotente par (rapport, version) ;
  - CHECK `(review_kind = 'automatic') = (reviewed_by is null)`, marque refusée aux membres en `WITH CHECK` ;
  - bornes du seuil en CHECK, explication validée par Zod et jamais journalisée, port sous les politiques de l'acteur pour les écrans.
- Acceptée par Charles le 06/11 à 12 h 58 (« ok 0073 »).

Pas fait : le code (CR-09 à réécrire sur cette ADR), dans une PR à part, avec une migration attribuée à l'arrivée sur `main`.

Décisions :
- La référence est le brut TTC lu par Reveal (`revenueTtc`), ce que le chatteur déclare, sur les ventes attribuées selon l'ADR 0050 § 5.
- Sans comparaison possible (flux coupé, chatteur non relié), rien n'est bloqué.

Découvertes :
- Ma première réponse à Charles sur ce sujet oubliait l'ADR 0043 § 4. Elle a été corrigée dans le fil Équipe.

Candidats à suppression : aucun.

Vérifié : `pnpm check`.
