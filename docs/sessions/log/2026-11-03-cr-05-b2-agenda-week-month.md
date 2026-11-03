# 2026-11-03 — Agenda de la créatrice : Semaine et Mois sur ordinateur, glisser, balayer (CR-05, lot b2) — in-progress

Fait :

- Semaine sur ordinateur (900 px et plus) : grille d'heures de 7 h (ou plus tôt si une tâche commence avant) à minuit, une colonne par jour, ses dispos hachurées, les propositions de l'agence en pointillés, une rangée « tâches » pour ce qui n'a pas d'heure, le compte de sa routine sous chaque jour, la ligne de maintenant. La grille s'ouvre une heure avant maintenant (cette semaine) ou avant sa première tâche.
- Glisser : sur un temps libre, crée une tâche à ces heures (30 min au moins, au quart d'heure) ; sur une tâche, la déplace en gardant sa durée, même vers un autre jour. Au toucher, un appui long de 380 ms lance le glisser, sinon la page défile.
- « Changer le moment » dans la tâche ouverte : jour, début et fin, l'équivalent clavier du glisser. Le déplacement s'affiche tout de suite et revient si le serveur refuse.
- Mois sur ordinateur : semaines entières du mois, trois lignes par jour (heures d'abord) puis « +N » ; un jour s'ouvre dans Jour ; flèches du clavier d'un jour à l'autre. Sa routine reste dans Jour.
- Jour sur ordinateur : frise proportionnelle de ses heures avec maintenant. Jour au toucher : un balayage change de jour.
- `?vue=mois` dans l'adresse ; sur téléphone, Mois retombe sur Ma semaine.
  Pas fait : lot b3 (rappels par Web Push), lot c (écran agence, iCal, couche des shifts).
  Décisions :
- Un glisser ne change jamais la nature d'une tâche (une tâche du jour reste du jour, une routine ne se glisse pas).
- Les tâches qui se chevauchent se partagent la largeur de la colonne.
- Les cases d'événement ont un fond plein pour que la ligne de maintenant passe dessous.
  Découvertes : aucune.
  Candidats à suppression : aucun.
  Vérifié :
- `grid.test.ts` (7 tests : heures, couloirs, minute sous le pointeur, création, déplacement, mois) ;
- `AgendaPage.test.tsx` : grille et mois sur ordinateur, « Changer le moment » envoie le bon `PATCH` (33 tests de l'agenda au total) ;
- captures ordinateur Nuit et Jour, glisser pour créer et pour déplacer, Mois, frise, « Changer le moment », dans les fichiers du projet (`espaces/agenda-b2/`).
