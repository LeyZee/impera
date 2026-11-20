# 2026-11-20 — Demande sur mesure : comprendre avant son oui (ADR 0159 § A.2) — done
Fait : contrat `custom-orders` (lecture du cerveau stricte et « depuis le modèle », détails par format, états) ; `customOrderTurn` pur dans le module `custom-orders` (ce qui prime, refus par la grille, une question à la fois, fiche à la créatrice ou au propriétaire, fan gardé au chaud, gardes `no_commitment` et `no_tip_request`) ; trois scénarios d'éval (question joueuse, appel sans compte ni heure, paiement hors plateforme) ; glossaire « Fiche sur mesure » ; ADR 0159 « Mise en œuvre » mise à jour (attente levée par Charles le 20/11 15 h 29).
Pas fait : le branchement dans le tour de l'agent et la lecture par le cerveau (fil Agent), la garde `no_tip_request` côté voix (fil Agent), l'enregistrement de la commande et la fiche dans « À traiter » (lot suivant).
Décisions : partage avec le fil Agent (20/11 15 h 32).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires contrats et module, typecheck, lint, schéma des scénarios d'éval.
