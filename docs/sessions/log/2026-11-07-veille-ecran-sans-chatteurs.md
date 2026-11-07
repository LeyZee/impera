# 2026-11-07 — La veille cachée aux chatteurs, à l'écran (EXT-09, ADR 0060 § 2 amendée) — done
Fait : vérifié que l'écran suit déjà l'amendement de #637. Dans le CRM, un chatteur et un manager absent ou parti (`teamScope: 'self'`) n'ouvrent que la persona d'une créatrice (`sheetsFor`) : ni « Idées du jour » ni « Coller un lien » ; Moi › Sécurité ne leur montre pas « Relier l'extension » (`extensionLinks` réservé à `agency`). Dans la popup, la carte « Veille » n'est offerte qu'au propriétaire et à un manager actif ; la règle a maintenant un nom (`watchesInstagram`, `apps/extension/src/lib/who.ts`) et des tests, comme `sheetsFor`. Un lien déjà fait qui reçoit 401 est retiré et la popup le dit (inchangé).
Pas fait : rien.
Décisions : aucune nouvelle ; l'écran lit `me` (rôle et `teamScope`), le serveur reste la barrière (403 `trend_link_forbidden`, 403 `extension_link_forbidden`, 401).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests `apps/web/src/creators/search.test.ts` (nouveau) et `apps/extension/src/lib/who-tab.test.ts`, lint et typecheck de l'extension.
