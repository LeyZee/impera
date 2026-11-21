# Module `creator-limits` : ce qu'elle dit elle-même à l'agence (Charles, 21/11)

Deux petits écrans de son « Aujourd'hui » : « Je serai absente » (du … au …, une note) et « Je ne fais plus quelque chose » (ses mots). Elle les écrit seule, dans son propre compte ; elle peut les reprendre, jamais les effacer (la ligne reste, marquée). Son équipe les lit comme sa fiche de chatteur : le propriétaire, qui l'a dans sa liste, et un chatteur en poste pour elle. Le chatteur les voit sur son accueil ; le propriétaire met sa fiche à jour à partir d'eux (l'IA lit la fiche, pas ces tables).

- **Peut dépendre de** : `scheduling` (son jour dans son fuseau, par `pure.ts`).
- **Tables** : `creator_absences`, `creator_stops` (migration 0247), FORCE RLS : elle écrit les siennes, toute transaction ouverte sur sa créatrice les lit.
- **Routes** : `GET /v1/creator-space/limits`, `POST /v1/creator-space/absences`, `POST …/absences/:id/cancel`, `POST /v1/creator-space/stops`, `POST …/stops/:id/withdraw` (elle) ; `GET /v1/creators/:creatorId/limits` (son équipe).
