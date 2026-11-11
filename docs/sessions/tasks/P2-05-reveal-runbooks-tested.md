# P2-05 Runbooks Reveal testés sur le compte de test

Statut : todo
Phase : 2
Dépend de : P2-03
Branche : task/p2-05-reveal-runbooks-tested

## Objectif
Les procédures session expirée, re-sync, coupe-circuit et kill switch sont jouées pour de vrai, avec le membre « bot » et le seul fan « test », à la demande de Charles.

## Contexte à lire
`docs/runbooks/session-expired.md`, `docs/runbooks/reveal-capture-express.md`, `docs/reference/reveal-connector-spec.md` § 7.

## À faire
- Avec Charles, sur sa demande écrite : lecture réelle du compte, puis un envoi de texte et une étape de script vers le fan « test » seulement, `writes` activé à la main sur ce compte et désactivé après.
- Provoquer et noter : session expirée et re-sync, coupe-circuit, kill switch ; corriger les runbooks d'après ce qui s'est passé.
- Consigner dans `reveal-api-observed.md` ce qui diffère de FakeReveal, et corriger FakeReveal.

## Critères d'acceptation
- Chaque runbook a une ligne « joué le <date> » et ses écarts corrigés.
- Aucun message parti vers un autre fan que « test » (journal des envois).

## Hors périmètre
Déploiement (P2-06).

## Notes de session
