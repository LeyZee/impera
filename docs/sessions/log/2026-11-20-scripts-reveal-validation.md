# 2026-11-20 — Valider les scripts Reveal (descriptions puis identité) — done
Fait : routes `POST /v1/creators/:creatorId/platform-scripts/:scriptId/descriptions/validate` et `…/descriptions/correct` (propriétaire et managers de sa liste, RLS, audit, idempotence, refus `stale` et `alone` en 409, job d'identité mis en file) ; la liste des scripts natifs montre la description de chaque média d'étape ; carte « Ses scripts dans Reveal » sous le coffre (Créatrices › Scripts) : une ligne par script actif avec le prochain geste, descriptions à relire (lot pour celles sans réserve, une à vérifier seule, correction en place), puis identité à valider ou corriger.
Pas fait : conditions des étapes à branches (ADR 0112, sans écran : la ligne dit « conditions à régler ») ; texte écrit à la main pour un média que la vision n'a pas pu lire (`to_agency`), qui viendra avec la fiche d'un média en grand.
Décisions : aucune nouvelle ; l'agence valide (ADR 0030 § 3, 0083, 0099 § 4).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : intégration scripts natifs ✓ (16 tests), tests web des scripts ✓ (29 tests), captures Nuit/Jour PC/téléphone (lot scripts-reveal-1) envoyées à Design.
