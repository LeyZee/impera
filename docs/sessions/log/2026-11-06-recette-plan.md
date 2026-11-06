# 2026-11-06 — Plan de recette complète d'Impera — done

Fait : inventaire de tous les écrans, sous-onglets et rails (`docs/recette/inventaire.md`) ; plan de recette en cinq lots par zone de propriété plus les parcours transverses ; état de chaque clé et proposition d'un bac à sable (Reveal et IA simulés) ; relecture du dispositif de capture Reveal, page express et référence corrigées (session du bot partout, bundle, vocal, vidéos, Edge, chemin du clone) ; liste courte de ce que Charles teste lui-même sur Reveal.
Pas fait : la recette elle-même (un fil par zone, lancé par le coordinateur) ; aucun code.
Décisions : aucune ADR ; une page qui manque au bot n'est plus refaite avec le compte de Charles (règle « session du bot, jamais la sienne »).
Découvertes : la pile de dev ne branche aucun connecteur ni faux fournisseur d'IA, donc la boucle de l'agent ne se voit sur aucun écran sans clé ; FakeReveal (prévu pour le dev local) n'est lancé par rien ; l'extension n'appelle pas `POST /v1/connector/sessions` ; aucun stockage S3 dans `docker-compose.yml` ; aucun jeu de données de recette. Fiche proposée : `docs/sessions/tasks/PROPOSED-recette-sandbox.md`.
Candidats à suppression : aucun.
Vérifié : pnpm check:repo ✓, prettier ✓ sur les fichiers touchés.
