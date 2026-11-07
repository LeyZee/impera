# 2026-11-07 — Veille sans chatteurs (EXT-09, ADR 0060 § 2 amendée)

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, après la décision de Charles du 07/11, 12 h 13 (« la veille, ça doit concerner que la modèle et à aucun moment un chatter »)

## Fait

- ADR 0060 § 2 amendée : la veille est au propriétaire, aux managers actifs et à la créatrice ; un chatteur ne colle aucun lien, ne relie pas l'extension pour la veille, ne marque aucun post et ne voit la veille nulle part. Un manager absent ou parti est traité de même.
- Serveur (`trends`) : « Coller un lien » refuse un chatteur (`trend_link_forbidden`) ; un lien d'extension ne se crée que pour le propriétaire, un manager actif ou une créatrice (`extension_link_forbidden`) ; un lien déjà fait cesse d'ouvrir les portes de l'extension dès que son titulaire devient chatteur ou s'absente (relu à chaque appel).
- Tests : `trends.integration.test.ts` (chatteur refusé partout, manager devenu chatteur puis absent).

## Reste

- Masquer la veille à l'écran pour un chatteur (CRM et popup de l'extension) : fil Extension.
- Les phrases de l'amendement attendent « ok phrases 0060 » de Charles avant la fusion.
