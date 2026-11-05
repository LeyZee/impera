# 2026-11-05 — CRM-07 b2 : le nombre de nouvelles créatrices sur l'onglet Ventes — done

Fait : l'onglet Réglages › Ventes porte le nombre de modèles que Reveal listait à sa dernière lecture, sans lien ni écartées (`GET /v1/settings/sales-feeds/new-models`, #545). Le chiffre est dit en toutes lettres au survol et au lecteur d'écran (« 3 nouvelles créatrices sur Reveal », ADR 0069 § 5) ; le compte est relu à chaque lecture du bloc d'import, si bien qu'un import ou une créatrice écartée le fait baisser. `SubNav` prend un `countLabel` facultatif pour cela.
Pas fait : sur la fiche d'une créatrice importée, ce qui reste à faire (pourcentage, fuseau, persona, invitation) : PR suivante.
Décisions : le compte suit la liste d'import, tout statut compris (Bilan, 05/11) ; une erreur ou une attente laisse l'onglet nu, jamais un chiffre faux ; pas de nombre dans la barre du téléphone ni dans « Plus » (ADR : « dans Réglages »).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `SettingsLayout.test.tsx` et `importing.test.ts` (4 nouveaux) ; captures Nuit et Jour, ordinateur et téléphone, hors dépôt (`reglages-ventes/crm-07b2/`).
