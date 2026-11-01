# 2026-10-31 — ADR 0038 : le report borné pour payer chaque facture avant son échéance (fil Équipe) — done
Fait :
- `docs/adr/0038-bounded-carry-over-before-due-date.md` et sa ligne dans l'index : échéance à l'émission plus 60 jours par défaut au lieu de 15 (réglage de 45 à 60), un total positif sous le minimum reporté deux fois au plus et versé à la troisième quinzaine, l'hypothèse de validation et de virement qui tient la garantie (l'alerte d'échéance au-delà), un cumul nul ou négatif qui ne verse rien et remet à zéro le nombre de reports, un report positif repris d'Imperium versé par la première quinzaine de Nirvana, alertes d'échéance J-7 et dépassée au lot 8.
- Acceptée par Charles le 31/10 à 14h20 (« ok 0038 », après « ok ;) » au versement des reports repris d'Imperium) ; texte précisé avant fusion à la relecture d'Extension (neuf remarques), phrases amendées montrées mot pour mot à Charles, qui les a lues (« ok ;) », 14h31). Ligne de statut de l'ADR 0023 complétée.
Pas fait : le moteur de paie, la base et le glossaire (PR à part, fil Équipe).
Décisions : avis de comptable demandé par Charles le 31/10 ; le plafond de 60 jours et les conditions de paiement sur chaque facture sont dans #328 (EQ-06 lot 3), seul le report borné change une règle d'Imperium et passe par cette ADR.
Découvertes : le délai de versement annoncé (PAIE-32, jusqu'à 30 jours ouvrés) n'est qu'une annonce : la garantie repose sur une validation et un virement rapides, et l'alerte d'échéance du lot 8 est le seul filet au-delà.
Candidats à suppression : aucun.
Vérifié : `pnpm exec prettier --check` et `node scripts/check-repo.mjs` sur les fichiers touchés.
