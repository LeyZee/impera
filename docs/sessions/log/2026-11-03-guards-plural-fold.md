# 2026-11-03 — Gardes : le pluriel des limites de la persona — done
Fait :
- `forbiddenMatch` (gardes de l'agent) plie le pluriel de chaque mot d'une entrée : un « s » ou un « x » final retiré quand il reste quatre lettres au moins, puis l'un ou l'autre admis. « pied » lit « pieds » et l'inverse, « cheveu » lit « cheveux ». « bras » ne lit jamais « bra », et l'entrée reste lue en mots entiers.
- `touchesTerm(text, term)`, exporté par l'index d'`agent` : la seule lecture d'une limite de la persona, pour l'agent comme pour `scripts` (SC-02, ADR 0056 § 1).
Pas fait : le passage de `scripts` sur `touchesTerm`, qui revient à Médias en SC-02.
Décisions :
- Pas de lemmatisation ni de dépendance : un pluriel irrégulier (œil, yeux) reste une variante écrite dans la persona.
- Le pli vaut aussi pour les réponses de l'agent et pour les messages des chatteurs (ADR 0052) : un « pieds » qui passait jusqu'ici était un trou.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests de `guards.test.ts` (pli, mots entiers, `touchesTerm`) ; `pnpm check` et `pnpm test`.
