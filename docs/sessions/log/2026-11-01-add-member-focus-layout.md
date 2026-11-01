# 2026-11-01 — Équipe › Membres : le focus du panneau d'ajout posé dans le commit (fil Extension) — done

Fait : `AddMemberPanel` pose le focus de chaque étape (premier champ, puis « Copier le message » une fois le membre ajouté) et celui du premier problème dans un `useLayoutEffect`, et non plus dans un `useEffect`. Le focus arrive dans le commit qui montre l'étape, avant qu'elle soit peinte. Avant, sur un runner chargé, l'effet passif pouvait arriver après que le test (MembersPage, « goes through the three steps… ») avait lu `document.activeElement` (CI de #341, remarque d'Équipe).
Décisions : correction dans le composant plutôt qu'un `waitFor` dans le test. L'écran gagne aussi : aucune image peinte avec le focus ailleurs.
Découvertes : sous une charge forcée (8 processus `yes` sur 4 cœurs), `PlanningPage.test.tsx` « takes « Voir le shift »… » a dépassé une fois le délai de son `waitFor` ; pas vu en CI, non traité ici.
Candidats à suppression : aucun.
Vérifié : `pnpm check` ; tests d'Équipe (88/88) ; MembersPage.test.tsx 8 fois de suite sous charge sans échec.
