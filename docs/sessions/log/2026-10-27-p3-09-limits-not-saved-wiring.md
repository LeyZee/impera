# 2026-10-27 — P3-09, branchement de `onLimitsNotSaved` dans la composition root — done
Fait : quand le moteur ne parvient pas à enregistrer l'âge déclaré par le fan (`ageConfirmedAt`), la composition root écrit un `warn` « fan limit not saved » avec la conversation et la limite, comme pour les notes écartées. Le brouillon reste prudent : rien n'est confirmé.
Pas fait : rien.
Décisions : un journal plutôt qu'une métrique, tant qu'aucune métrique n'existe pour les notes écartées non plus.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test. Le comportement du rappel est couvert par `draft-composer.test.ts` (« counts a declared age it could not save ») ; seul le branchement est ajouté ici.
