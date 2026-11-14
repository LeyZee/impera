# Module `rewards`

**Rôle.** Le jeu du chatteur (CHF-01, ADR 0104 § 12 à § 20) : noter une seule fois ce qu'un chatteur a gagné (un palier atteint dans une quinzaine, un trophée), tenir sa série de shifts avec le rapport rendu à l'heure, et lui rendre sa vitrine. Seuls les chatteurs jouent ; un manager, le propriétaire et une créatrice n'ont pas de vitrine ici (§ 20).

**Peut dépendre de.** aucun module métier (feuille). Deux lectures, branchées par le composition root (`RewardsReads`, `apps/api/src/wiring/rewards.ts`) : les faits de paie d'un membre (`payGameFactsUnscoped`, exporté par `payroll`) et ses shifts avec leurs rapports (`shiftsForGameUnscoped`, exporté par `scheduling`). Le module ne fait que LIRE la paie et le planning : il n'écrit dans aucune de leurs tables, et rien de ce qu'il note n'entre dans un relevé (§ 17, vérifié par `rewards.integration.test.ts`).

**Tables possédées.** `reward_gains` et `reward_streaks` (migration 0194), en FORCE RLS. Le job les écrit par la connexion admin ; l'application lit les lignes du compte (le propriétaire et un manager actif lisent celles de l'équipe) et ne peut changer que `revealed_at` de ses propres gains. Rien n'est supprimé. `user_preferences` (même migration) appartient à la session (`apps/api/src/auth.ts`, `PUT /v1/me/preferences`).

**Job.** `rewards.evaluate`, toutes les 10 minutes (`crontab.ts`), rejouable : la contrainte `reward_gains_once` (compte, type, clé) fait qu'un gain n'est noté qu'une fois. Aucune notification n'est envoyée (§ 18).

**Routes.** `GET /v1/rewards/my-trophy-case` (la vitrine de la session) et `POST /v1/rewards/my-trophy-case/reveals` (marquer des dévoilements vus), chatteurs seulement. Aucune ne prend d'identifiant de compte : le serveur répond pour la session.

**Règles propres** (`domain/`, testées) :

- un gain de palier a pour clé `<quinzaine>:<seuil>` et, dans la vitrine, le type `tier:<quinzaine>:<seuil>` ; un trophée n'a pas de clé et ne se gagne qu'une fois ;
- un rapport est « à l'heure » s'il est rendu au plus `REPORT_ON_TIME_HOURS` (12 h) après la fin du shift ; un repos ne casse pas la série, un rapport en retard ou manquant la remet à zéro (§ 13) ;
- aucun tirage au hasard, aucune comparaison entre chatteurs, aucun montant sur un trophée (§ 17, § 18).
