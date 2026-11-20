# 2026-11-20 — Playground : une vente fictive de bout en bout — done
Fait : demande de Charles du 20/11 (jouer le fan jusqu'à l'achat, en fictif). Deux scripts d'essai inventés (un Jour, un Nuit : étape offerte, payante, pont) que le Playground lit comme un catalogue de plateforme, par les mêmes fonctions que la production (`scriptTurn`, `applyScriptRunEvent`, `reconcileScriptRun`). Le média de chaque étape arrive après son texte, flouté si payant, avec « Payer (fictif) » et « Refuser » ; payer ouvre le média et ajoute le prix à la dépense du fan simulé, refuser arrête le script ; deux messages hors sujet valent un refus, comme en production. « Rejouer d'ici » et « Recommencer » ramènent aussi le script et les achats. Un bandeau « Script d'essai » montre les étapes et le total acheté. La raison d'une offre refusée dit maintenant celle des scripts (âge, seuil, étape en attente, refus). Rien ne part vers Reveal, ni dans les ventes ni dans les chiffres (ADR 0103 § 15-17).
Pas fait : son vrai catalogue au Playground (lot 2, par `ScriptSource`) ; l'état du script vit en mémoire comme la session.
Décisions : aucune ADR touchée (0103 § 15-17 couvre tout).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests du Playground (serveur et écran), pnpm check.
