# 2026-11-06 — EQ-21 : le rapport de fin de shift rappelé sur le téléphone (ADR 0077)

Fait :
- ADR 0077 écrite après la question de Charles sur le rapport (« attaque ça », 18 h 51), relue par Bilan (une raison propre au premier rappel, un seul ensemble d'exceptions dans `policy.ts`), acceptée (« ok rappel-double », « ok rappel-de-nuit », « ok 0077 »).
- `notifications` : raison `own_shift_end` (contrat, CHECK, migration 0136) ; `PASSES_QUIET_HOURS` (`own_shift_start`, `own_shift_end`), lu par `isCapped` et `decideNotification`.
- `scheduling` : `domain/report-reminders.ts` (fenêtres de 15 min – 2 h et 12 h – 14 h, exclusions, message), `infra/report-reminders.ts` (candidats par pages en admin, faits relus), `application/report-reminders.ts` (le job, un shift en échec n'arrête pas les autres) ; port `Notify` donné par le composition root ; `scheduling.remind_reports` toutes les cinq minutes.
- Le second rappel dit le jour du shift tel que le membre le lit au moment du rappel (« d'aujourd'hui », « d'hier », ou le jour de la semaine) : l'exemple de l'ADR, « d'hier », serait faux pour un shift de 0 h – 6 h rappelé à 18 h.
- Tests : règle et message, job (unitaire), job contre la base (rappels dus, annulé, rapport fait, source détectée, sans règles, membre parti, rejoué, rapport envoyé entre les deux lectures), politique (`own_shift_end` la nuit et au-delà du plafond).
- Recette Équipe (demandé par le coordinateur après 0077) : le rapport ouvert depuis Équipe › Planning ou Rapports lisait l'heure de l'appareil, invisible tant que le propriétaire est à Paris. Planning lui passe l'heure de sa semaine (l'agence, ou la sienne à la demande), Rapports lit le fuseau de l'agence pour toute la page ; tests lus depuis Antananarivo.

- 07/11 : poussé sur la même branche après la fusion de #624 ; migration régénérée derrière la 0135 de Bilan (0133 attribuée d'abord, mais la 0134 de la persona est passée avant : Bilan a donné 0136).

Reste : la relecture de `policy.ts` par Bilan.

Découvertes :
- La politique `manager_invite` des taux de #626 lit le préréglage en vigueur au jour d'arrivée, et #624 au jour courant : écart signalé sur #626 (un manager qui antidate retrouverait un ancien barème plus haut).
- `today()` du module `team` lit le fuseau constant `Europe/Paris`, Bilan lit `scheduling_settings.time_zone` : les deux divergent si l'agence change de fuseau. Non traité.
