# 2026-11-05 · MOT-04 (suite) : « Wise » ne bloque que comme moyen de paiement

- Fiche : recette du 05/11, MOT-04, remarque d'Extension sur #529.
- Fait : la garde `off_platform_payment` ne bloque plus le mot anglais « wise » seul (« that's wise »). Elle le bloque encore quand il désigne la banque : « par/sur/via/avec Wise », « t’as Wise ? », « on/by/through Wise », « wise transfer/account ».
- Tests : `guards.test.ts` (« Tu peux passer par Wise », « send it with a wise transfer » bloqués ; « That's wise of you », « wise choice » passent).
- Découvertes : aucune.
