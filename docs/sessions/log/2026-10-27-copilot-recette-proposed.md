# 2026-10-27 — Recette du copilote : fiche proposée — done

Fait : fiche `docs/sessions/tasks/P3-08-copilot-recette.md` (ID validé par Charles à 17h56). Elle décrit la recette que Charles jouera dans Suivi, de bout en bout : des fans inventés écrivent depuis FakeReveal, l'agent rédige avec le vrai modèle, et la garde d'écriture reste fermée. Elle couvre neuf cas (KYC, piège coupé, piège dans un média, détresse, mineur, offre et délai, « t'es un bot ? », rencontre, prise en main) et précise ce que Charles doit voir et ce qui ne doit jamais arriver.

Pas fait : aucun code. La recette attend `RevealApiConnector` (fiche Reveal) et deux prérequis de Bilan : le refus d'une URL Reveal locale en production dans `loadConfig`, et le contrôle de démarrage de la garde d'écriture.

Décisions : Bilan (propriétaire de `composition-root`) préfère un lanceur qui ne sert que FakeReveal, l'API restant celle de `pnpm dev` ; la recette dépense sur le plafond des fans.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`.
