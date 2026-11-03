# 2026-11-03 — CRM-03, raison du refus de bascule à l'écran (Extension) — done
Fait :
- `apps/web/src/reports/api.ts` : un refus garde `details.reason` de `pay_rules_source_conflict` dans `sourceReason`, lu avec `PayRulesSourceRefusalSchema` ; une raison inconnue est ignorée sans perdre les autres détails.
- `apps/web/src/reports/model.ts` : `SOURCE_REFUSAL_TEXTS`, une phrase par raison qui dit ce qui manque et où le régler, et `refusalText` ; le message du code seul ne dit plus « pas encore relevées ».
- Réglages › Règles de paie affiche `refusalText`. Tests : modèle et écran (raison connue, raison inconnue).
Pas fait : ouvrir le choix « Ventes relevées », qui reste désactivé (c'est la bascule, accord de Charles).
Décisions : aucune plateforme nommée dans ces phrases, l'écran les sert toutes.
Découvertes : la note sous le choix désactivé (« quand le connecteur saura les lire ») sera à revoir au moment d'ouvrir la bascule.
Candidats à suppression : aucun.
Vérifié : tests web des règles de paie et du modèle des rapports ; pnpm check.
