# 2026-11-26 — Coffre Impera : ce que l'IA tire du coffre (CR-17) — in_progress

Fait : catégories « Vocal du bip », « Vocal bien réelle », « Vidéos à vendre » (contrats, base, demandes, coffre) ; `content-drops` › `reserved` : l'agent pioche un vocal (une fois par fan) ou un cadeau baleine (jamais deux fois le même, prouvé doux), seulement ce que l'agence a validé, et note l'envoi confirmé dans `media_sends` (prix vide, index unique partiel, rejouable) ; ADR 0163 § 7 complété ; branche remise sur main (migration 0255 régénérée après 0253 et 0254).
Pas fait : type de vidéo à vendre au dépôt (attend les lignes « Vidéos déjà tournées » de Sur mesure) ; jetons de couleur 11 à 13 (Design) ; « À remplacer » (PR du fil Médias).
Décisions : la lecture passe par la porte du travail `drop_media` sous son locataire, ses dépôts ne s'ouvrant pas à un locataire nu.
Découvertes : `apps/extension/.wxt/tsconfig.json` (généré) peut sortir corrompu quand deux tests de build tournent en même temps ; `wxt prepare` le refait.
Candidats à suppression : aucun.
Vérifié : typecheck api, lint du module, tests unitaires du module (115), intégration coffre et réserve (9).
