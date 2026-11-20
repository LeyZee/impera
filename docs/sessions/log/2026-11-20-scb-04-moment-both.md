# 2026-11-20 — SCB-04 Moment « jour et nuit » d'un script en préparation — done
Fait : le moment d'un script en préparation prend « jour et nuit » en plus de « le jour » et « la nuit » (contrat `PreparedScriptMomentSchema`), choisi à la main dans « Nouveau script » et dans l'éditeur ; la liste dit « Jour et nuit ». Amendement de l'ADR 0112 (§ 27). La lecture `ours` d'un script natif choisit de façon déterministe si deux de nos scripts le nomment (remarque de Bilan sur #926).
Pas fait : rien côté agent ; un script « jour et nuit » n'y impose pas de moment (fil Agent).
Décisions : ADR 0112 § 27.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests web de l'onglet Scripts, tests du domaine scripts, typecheck API et web.
