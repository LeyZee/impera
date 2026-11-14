# 2026-11-14 — OPS-12 Le test de bout en bout part d'un compte déjà relevé — done
Fait : le compte du test e2e de la phase 0 est créé déjà relevé une fois, pour que le message du fan soit frais et non rattrapé (P2-02).
Pas fait : rien.
Décisions : aucune.
Découvertes : la CI de la PR #715 était verte alors que main ne l'est pas après sa fusion ; à comprendre (le job e2e tourne-t-il sur chaque PR ?).
Candidats à suppression : aucun.
Vérifié : `pnpm check` en local ; le test e2e sur la CI de la PR (pas de Docker ici).
