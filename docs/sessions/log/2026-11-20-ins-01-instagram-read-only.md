# 2026-11-20 — INS-01 lot a (Instagram en lecture seule : contrats, domaine, faux) — in progress

Fait : contrats `instagram-insights` (média, nombres stricts, relevé par âge, story en ligne, droits de lecture et de publication en listes fermées) ; domaine `connectors/domain/instagram-insights.ts` (port en lecture seule, `grantOf` qui refuse un droit non demandé et tire le drapeau de publication des droits accordés, paliers, plan d'une nuit borné par le quota, état du jeton, alerte de deux nuits ratées) ; `FakeInstagramInsights`. Tests : job rejoué sans doublon, palier jamais remplacé, quota atteint puis reprise, compte en lecture seule sans drapeau de publication.
Reste : lot b (table des relevés, job de nuit), lot c (branchement dans Réglages, relu par Sécurité), lot d (adaptateur officiel, essai réel).
Découvertes : `docs/architecture/connectors.md` range encore `InstagramConnector` en phase « 7+ / plus tard » ; à remettre à jour quand l'adaptateur officiel arrive (lot d).
