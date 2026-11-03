# Module `creator-tasks` : l'agenda de la créatrice (CR-05, ADR 0042 § 3 et § 4)

Ses **tâches** (avec une heure de début et de fin, ou juste un jour, à cocher), sa **routine** (les tâches de chaque jour), ses **dispos** (le temps qu'elle ouvre à l'agence) et les **suggestions** de l'agence ou de l'IA, qu'elle accepte ou refuse. Le mot « créneau » n'existe pas ici : il est celui des shifts (ADR 0049).

**Peut dépendre de.** `scheduling`, par son `pure.ts` seulement (ADR 0051) : les jours et l'heure de son fuseau (`addDays`, `isoWeekday`, `wallClockToInstant`).

**État.** Lot a en cours : les règles pures (`domain/`). Les tables, la RLS, les contrats et les routes suivent dans le même lot (migration 0103) ; les écrans au lot b ; l'écran de suggestion de l'agence, son lien iCal et la couche des shifts au lot c.

## Règles pures (`domain/`)

- **Série** (`streak.ts`) : une journée est « réussie » quand toutes ses tâches essentielles sont cochées (la routine de l'agence qu'elle a acceptée), « parfaite » quand toutes ses tâches du jour le sont (les siennes comprises). La série compte les journées réussies d'affilée dans **son** fuseau ; aujourd'hui compte dès qu'il est réussi et ne casse jamais tant qu'il dure (« série en danger » seulement). Une journée sans essentielle ne compte ni ne casse. Un joker pardonne une journée manquée dans la série, la deuxième la casse ; un joker n'est dépensé que s'il sauve une journée réussie d'avant. Paliers 7, 14, 30, 50, 100.
- **Dispos** (`availability.ts`) : récurrentes (un jour de la semaine, en heure de son fuseau, jusqu'à 24 h de long, minuit franchi compris) ou ponctuelles. Une dispo de 18 h à 22 h reste de 18 h à 22 h après un changement d'heure ; la nuit du passage à l'heure d'été, une heure qui n'existe pas devient la première qui existe.
- **Placement** (`placement.ts`) : une suggestion datée ne tombe qu'entièrement dans une dispo, et sur aucune de ses tâches à heures (deux bornes qui se touchent ne se chevauchent pas). Sinon elle reste sans date, dans « Ma semaine » ; elle n'est jamais déplacée pour elle.
- **Suggestions** (`suggestions.ts`) : suggérée, puis acceptée ou refusée, une fois. Le même geste rejoué ne change rien ; l'autre geste sur une suggestion décidée est refusé (`creator_suggestion_decided_conflict`). Une tâche refusée n'est pas resuggérée la semaine du refus ni la suivante (même catégorie et même titre, sans casse, accents ni espaces en trop).
- **Coches** (`completion.ts`) : une coche par tâche et par jour, quel que soit le nombre d'appuis ou de rejeux de son téléphone revenu en ligne ; une coche déjà là ne change pas, et de deux coches nouvelles la plus ancienne reste. Une coche compte pour le jour qu'elle nomme, pas pour l'heure où elle arrive.
