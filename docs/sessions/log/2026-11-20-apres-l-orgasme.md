# 2026-11-20 — ADR 0156 § 6 : après l'orgasme, plus rien à vendre ce soir-là — in progress
Fait : nouveau signal fermé du cerveau `just_came` (cerveau 1.23.0), poids de désir -50 ; quand son dernier message le dit, aucune étape ne part et aucune offre n'est acceptée (refus `he_came`, libellé au Playground), son message ne répond ni ne refuse l'étape en attente (le déroulé reste en pause, puis se clôt `stalled` avec un rappel quand il revient froid, § 1), et la voix reçoit une consigne de tendresse sans rien vendre ni relancer le jeu. Scénario d'éval `he-came-aftercare` (non lancé).
Pas fait : relances de vente (`post_offer.delay_days`, § 5) ; « vexée s'il jouit sans acheter » (ADR 0158, lot vente par script).
Découvertes : aucune.
