# 2026-11-05 — Agenda de la créatrice : son lien de calendrier (CR-05 lot c2) — in-progress

Fait :

- Son lien de calendrier sur la table et les routes de l'équipe (ADR 0042 § 4, ADR 0045 § 5) : `calendar-link-store.ts` accepte un compte créatrice (verrou sur la ligne du compte), et le titulaire d'un jeton devient `member` ou `creator`.
- Son flux « Impera · mon agenda » : `scheduling` l'écrit, `creator-tasks` le lit avec ses droits (`feedOf`, port `CreatorAgendaFeed`). Il contient ses tâches à heures et celles d'un jour, celles-ci en date (`DTSTART;VALUE=DATE`, transparentes).
- « 📲 Mon agenda dans mon téléphone » sous son agenda, qui ouvre le parcours de Moi › Calendrier (`CalendarLinkBody`, extrait et partagé) avec ses mots.
- Les emojis des catégories passent dans `contracts` (`CREATOR_TASK_CATEGORY_EMOJI`), lus par ses écrans et par son flux.
- La composition crée `notifications` et `creator-tasks` avant `scheduling`, qui lit son agenda.

Pas fait : lot c3 (les shifts de ses comptes dans son agenda et dans son lien).

Décisions :
- ni routine ni dispo dans son téléphone : une routine n'a pas de date, et une dispo est du temps donné à l'agence ;
- la fiche de tournage n'y est que nommée, parce qu'Apple et Google gardent le flux sur leurs serveurs ;
- l'identifiant d'un événement est celui de la tâche, donc une tâche déplacée bouge au lieu de doubler.

Découvertes :
- aucun parcours ne retire l'accès d'un compte créatrice ; le jour où il existera, il devra révoquer son lien de calendrier, comme le départ d'un membre (ADR 0045 § 6).

Candidats à suppression : aucun.

Vérifié :
- `pnpm check` ;
- unitaires `calendar-feed` (jour entier) et `creator-tasks/domain/feed` ;
- intégration `creator-calendar-link` (3), `scheduling-calendar-link`, `creator-agenda` ;
- `AgendaPage.test.tsx` et `MyCalendarLinkPage.test.tsx`.
