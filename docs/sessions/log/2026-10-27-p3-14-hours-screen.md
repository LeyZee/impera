# 2026-10-27 — P3-14 Écran des heures d'activité — done
Fait :
- `apps/web/src/creators/hours/` : `model.ts` (mots du planning, semaine en barres, erreurs du contrat rangées par ligne, avertissement sans relance possible), `api.ts` (`GET`/`PUT /v1/creators/:id/agent-hours`, réponses lues par le contrat, `ReauthRequired` sur une connexion ancienne), `HoursSection.tsx` et `hours.css`.
- Créatrices : onglet « Persona · Heures d'activité » réservé au propriétaire, adresse `/creatrices?onglet=heures` (`search.ts`) ; un autre rôle est renvoyé sur `/creatrices`.
- `PasswordPrompt` prend une phrase d'introduction (`lead`) et importe sa feuille de style.
- Suivi : `reply_deferred` devient une note « Hors de ses heures : la réponse attend l'ouverture de son créneau, à 9 h / demain à 9 h / lundi à 9 h », une seule par ouverture.
- Tests : `model.test.ts` (11), `HoursSection.test.tsx` (9), une note de plus dans `reader-model.test.ts`. Captures 1 440 et 400 px, Nuit et Jour.
Pas fait : rien sur la fiche.
Décisions : aucune.
Découvertes : Chromium sans locale française montre les champs d'heure en « 11:00 PM » ; la largeur des champs (144 px) tient les deux formats. La note `reply_deferred` du Suivi se lit à l'heure du lecteur, comme toutes les heures du Suivi ; le jour où l'agence et une créatrice ne seront plus dans le même fuseau, il faudra dire la ville (« 9 h à Paris »), ce qui demande le fuseau de la créatrice dans la lecture du Suivi (relevé de Bilan sur #238).
