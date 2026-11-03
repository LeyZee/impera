# 2026-11-03 — Agenda de la créatrice : Jour, Ma semaine, coches hors ligne (CR-05, lot b1) — in-progress
Fait : onglet Agenda dans sa barre. Vue Jour, avec dans l'ordre :
- l'anneau fait / à faire, « Commence par », « En cours » ou « Ensuite », sa série ;
- les propositions du jour ;
- « À faire » ;
- « Programme », dont chaque temps libre se touche pour créer une tâche.

« Ma semaine » en liste : « Sans date » d'abord, ses dispos sous chaque jour. « Ajouter » → « Une tâche » ou « Une dispo ». Une proposition se décide : « Accepter », « Choisir un moment » quand elle est sans date, ou « Non merci » avec un motif facultatif. Une tâche s'ouvre et se retire, une dispo se retire.

Hors ligne : la dernière lecture de chaque semaine et les coches restent sur l'appareil, puis partent au retour du réseau. `forgetDevice` les efface à la déconnexion. Le test d'intégration de #502 vérifie maintenant le code `creator_tick_late_unprocessable` (remarque de Bilan).
Pas fait :
- lot b2 : Semaine et Mois sur ordinateur, appui long et glisser, balayer, la frise proportionnelle de la vue Jour sur ordinateur ;
- lot b3 : rappels ;
- lot c : écran agence, iCal, couche des shifts.
Décisions :
- Les deux vues lisent la même semaine, une requête par semaine.
- Une couleur par catégorie : tons clairs la nuit avec une coche sombre, tons foncés le jour avec une coche blanche.
- La dernière action sur une tâche et un jour l'emporte hors ligne.
- Une coche refusée par le serveur est oubliée et dite une fois.
- L'identifiant d'une tâche ou d'une dispo est tiré à l'ouverture du formulaire : un nouvel essai ne double rien.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié :
- tests du modèle, du hors ligne, du brouillon et de l'écran (21) ;
- `nav` et `AppShell` mis à jour ;
- captures téléphone et ordinateur, Nuit et Jour, dans les fichiers du projet (`espaces/agenda-b1/`).

Après relecture (même PR) :
- coches hors ligne : un lot refusé ne fait oublier que les coches qu'il nomme (`details.taskIds`), les autres repartent ; 401, 403, 408 et 429 sont retentés (une session expirée est dite comme telle) ; une coche faite pendant un envoi part dans l'envoi suivant (3 tests, `api.test.ts`) ;
- retours de Charles (03/11, 18 h 25) : plus aucune barre colorée sur le bord des cartes, chaque catégorie a sa pastille emoji sur sa couleur (`category.tsx`), « Ajouter » refait (deux cartes Une tâche / Une dispo, aperçu en direct, catégories en tuiles) ;
- passé en encre atténuée sans opacité, pastille « essentielle » non barrée, Live en doré (l'ambre est celui des avertissements). Captures v2 dans `espaces/agenda-b1/v2/`.
