# 2026-11-05 · PRO-14 a : le propriétaire renomme une créatrice

- Fiche : recette du 05/11, PRO-14, ADR 0071 § 1 (« ok 0071 » de Charles, 05/11).
- Fait : `PATCH /v1/creators/:creatorId` accepte `displayName` en plus de `timezone` (au moins l'un des deux). Le nom passe en premier : il reste unique (`creatorNameKey`, 409 `creator_name_conflict`, et le fuseau ne bouge pas alors), il est écrit sous verrou, et l'audit `creator.rename` garde `{ from, to }`. Le même nom ne réécrit rien. Le pseudo Reveal et la persona ne changent pas. À l'écran, un onglet « Profil » de la fiche, réservé au propriétaire, porte « Renommer » (`NameEditor`), avec le mot de passe redemandé après 10 minutes.
- Tests : `creators.integration.test.ts` (403 opératrice, 400 vide ou sans lettre, 409 homonyme sans écrire le fuseau, renommage et audit, même nom, ancien nom libéré, réauthentification), `NameEditor.test.tsx`, `CreatorsPage.test.tsx` (onglet Profil).
- Reste : archiver (migration 0118) puis corriger l'e-mail d'un accès pas encore utilisé, chacun dans sa PR.
- Découvertes : aucune.
