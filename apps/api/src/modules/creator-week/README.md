# Module `creator-week` : la semaine de la créatrice (ADR 0140)

Chaque dimanche à 18 h dans son fuseau, le code calcule sa **semaine** suivante sur ses vrais chiffres : ses **jours de tournage**, ce qu'il y a à tourner chaque jour, et l'échéance de **Livrer ma semaine** (le dimanche à 23 h). Le propriétaire relit, corrige et valide ; la semaine entre alors dans son agenda, où elle l'accepte d'un geste.

**Peut dépendre de.** `creator-tasks`, par son `index.ts` (la porte `week` et `accept`, ADR 0140 § 22) et `scheduling`, par son `pure.ts`. Le stock, les scripts demandés et ce qui est arrivé de sa livraison (`content-drops`), ses jours de tournage et ses dispos (`creator-tasks`) lui sont branchés par le composition root (`wiring/creator-week.ts`) : il ne lit aucune table d'un autre module.

**État.** Lot 1 : règles pures, contrats (`packages/contracts`, `creator-week.ts`), tables et RLS (migration 0235), job `creator_week.plan`, routes. Les écrans viennent au lot 2 ; les réglages par créatrice, le rappel du matin, le rappel au propriétaire du dimanche soir, la Relance, les idées et les mesures au lot 3.

## Ce que le code calcule (règles pures, `domain/plan.ts`)

- **Les besoins** (§ 4) : chaque script demandé et sans dépôt, dû avant la fin de la semaine ; les publications du feed qui manquent pour 3 par semaine (une séance, puis une vidéo courte, à tour de rôle), stock déposé et pas encore sorti déduit ; les stories qui manquent pour 7, en une seule ligne. La Relance et les idées n'entrent qu'avec le plan des Mass DM et les idées : rien n'est inventé.
- **La charge plafonnée** (§ 5) : chaque ligne va, dans l'ordre (script, feed, Relance, idées, stories), sur le jour qui a le plus de place, sans dépasser sa capacité ; les stories se coupent entre deux jours. Ce qui ne tient pas passe à la semaine d'après, et l'agence le voit (`deferred`).
- **Ses jours** (§ 1) : ceux qu'elle a gardés la semaine d'avant, tels qu'elle les a déplacés ; sinon les jours de ses dispos les plus longues ; sinon mercredi et samedi. Jamais plus que le nombre demandé.
- **Les réglages** (`WEEK_DEFAULTS`, fixés par bon sens le 20/11) : 2 jours de 4 h ; un script 1 h 30, une séance 45 min, une vidéo 30 min, une story 10 min ; échéance le dimanche à 23 h.

## Qui lit, qui écrit (migration 0235)

- **Le job** (`withAdmin`) écrit le brouillon (`creator_weeks`, un par créatrice et lundi), et le rafraîchit chaque heure du dimanche soir sur le stock de l'heure tant qu'il n'est pas validé ; une semaine validée n'est jamais touchée. Une créatrice dont la semaine ne se calcule pas n'arrête pas les autres, et rien n'est proposé pour elle.
- **Le propriétaire** valide, à son nom (politique `owner_validate`) ; **un manager actif** lit ; un chatteur ne lit rien ; **elle** ne lit jamais le brouillon.
- **La validation** écrit d'abord ses « Jour de tournage » et « Livrer ma semaine » (suggestions d'un jour, `week_role`) et leurs lignes (`creator_shoot_items`), sous des identifiants tirés de (elle, la semaine, le rôle, le jour) : rejouée, elle n'ajoute rien ; puis elle marque la semaine validée. Rejouée avec le même plan, elle répond la semaine ; un autre plan répond 409.
- **Elle** coche une ligne (son droit `UPDATE` limité à `done_at`, `done_by`) une fois le jour accepté, jusqu'à deux jours après lui ; la tâche du jour se coche quand toutes ses lignes le sont, et se décoche avec une ligne. « Livrer ma semaine » se fait par ses dépôts arrivés depuis lundi (et, pour un script, par le dépôt qui répond à sa demande), jamais par une coche.

## Routes

- `GET /v1/creators/:creatorId/weeks/:week` (propriétaire, manager actif) : le brouillon ou la semaine validée ; 404 avant le calcul.
- `POST /v1/creators/:creatorId/weeks/:week/validate` (propriétaire) : la semaine corrigée (jours, lignes déplacées, retirées ou reformulées) ; un jour hors de la semaine répond 422 `creator_week_plan_unprocessable`.
- `GET /v1/creator-space/week?week=` (créatrice) : ses jours de tournage et leurs lignes, sa livraison ligne par ligne ; vide avant la validation.
- `POST /v1/creator-space/week/accept` (créatrice) : « Accepter ma semaine », chaque tâche par ses propres règles ; rejouable.
- `PUT /v1/creator-space/shoot-items/:id` (créatrice) : une ligne tournée, ou reprise.

Une semaine se nomme par son lundi ; n'importe quel jour de la semaine lit la même.
