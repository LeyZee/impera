# 2026-11-20 — SCB-04 Moment « jour et nuit » d'un script en préparation — done
Fait : le moment d'un script en préparation prend « jour et nuit » en plus de « le jour » et « la nuit » (contrat `PreparedScriptMomentSchema`), choisi à la main dans « Nouveau script » et dans l'éditeur ; la liste dit « Jour et nuit ». Amendement de l'ADR 0112 (§ 27). La lecture `ours` d'un script natif choisit de façon déterministe si deux de nos scripts le nomment (remarque de Bilan sur #926).
Côté agent (après #929) : la vue d'un script « jour et nuit » ne porte aucun moment (`null`), il est donc offert de jour comme de nuit (`wiring/agent-scripts.ts`, testé). Sur téléphone, les trois choix tiennent sur une ligne (captures validées par Design).
Pas fait : rien.
Décisions : ADR 0112 § 27.
Découvertes : le job IA payant `scripts.identify_platform_script` et son rattrapage horaire écrivent des identités que plus rien ne lit pour vendre (ADR 0161 § 5) : à arrêter dans une PR à part, après #931.
Candidats à suppression : aucun.
Vérifié : tests web de l'onglet Scripts, tests du domaine scripts, typecheck API et web.
