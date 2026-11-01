# 2026-10-27 — EQ-02 : l'acceptation d'un échange ne nomme plus le shift du demandeur — done
Fait : `swap-store.ts`, à l'acceptation d'un échange, quand la contrainte d'exclusion des membres refuse le déplacement, `details.shiftId` ne nomme que le shift du collègue qui accepte ; celui du demandeur n'est plus donné (ADR 0031 : le shift de l'autre n'est jamais nommé). L'annulation par le propriétaire ou un manager actif nomme toujours le shift en travers, qu'ils lisent tous. Texte du contrat de `answer` précisé dans `packages/contracts/src/scheduling.ts`.
Pas fait : rien.
Décisions : `moveShifts` reçoit le lecteur (`reader`) : le membre dont un shift peut être nommé, ou `null` pour l'agence. Le refus garde son code, `shift_member_conflict`, sans `details` quand le shift en travers est celui de l'autre ; l'écran dit alors une phrase qui n'accuse aucun des deux (#237).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : le test d'intégration nouveau échoue sans le correctif (`details.shiftId` = shift de Théo), passe avec ; `scheduling-leaves-swaps` et `scheduling` verts (33 tests).
