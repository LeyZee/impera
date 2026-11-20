# 2026-11-20 — SCB-04 Éditeur des scripts, lot 3 écran — in_progress
Fait : l'onglet Scripts d'une créatrice a deux vues. « Scripts » liste ses scripts en préparation (état, premier manque, escalier des prix) ; « Nouveau script » crée un brouillon idempotent ; l'éditeur modifie nom, description, moment, étapes (rythme, ordre), branches (condition dans une liste fermée, teaser, texte d'offre, médias choisis parmi ceux importés et décrits, messages après le média, prix TTC) et s'enregistre seul sur la révision lue, avec reprise si quelqu'un a enregistré entre-temps ; manques et avertissements viennent du serveur ; le rail montre chaque chemin possible et ce qu'il coûte. « À copier dans Reveal » donne, pour chaque script prêt, les textes et prix à copier un par un, les médias dans l'ordre et ce qui diffère encore de Reveal, puis l'écran d'avant (scripts envoyés).
Pas fait : vue Performances (lot 4) ; teaser, messages après le média et rythme dans le déroulé (moteur, fil Agent).
Décisions : un chemin qui passe par une branche réservée à ceux qui ont pris une autre branche n'est ni montré ni compté ; les prix se saisissent en euros et s'enregistrent en centimes.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ; tests web (apps/web, 2 760+) ; captures Nuit/Jour PC/téléphone sur données inventées.
