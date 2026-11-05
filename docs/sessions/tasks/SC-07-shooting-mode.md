# SC-07 Mode tournage et ordre de tournage sur le téléphone de la créatrice
Statut : todo (idée acceptée par Charles le 03/11/2026, 13 h 38 : « ça peut être pas mal oui mais il va falloir que ce soit bien exécuté »)
Phase : scripts (ADR 0056)
Dépend de : SC-02 (la demande et la pile de cartons), SC-01 lot c2 (tenue et lieu par étape)
Branche : task/sc-07-shooting-mode

## Objectif
Le carton aide la créatrice à tourner (Charles, 13 h 37). Pendant la séance, elle n'a rien à noter : elle voit ce qu'il reste à tourner, dans le meilleur ordre, et la durée demandée de chaque vidéo.

## Contexte à lire
ADR 0056 (§ 2 à 4), ADR 0064 (cartons), SC-02, `docs/design/README.md` (mouvement réduit, cibles de 44 px).

## À faire
- [ ] Mode tournage dans la PWA : les cartons en plein écran et en vertical, un par un, en balayant (et au clavier). Chaque photo et chaque vidéo a sa case « fait ». Un chrono montre la durée demandée (de `minSeconds` à `maxSeconds`) sans jamais filmer lui-même.
- [ ] Ordre de tournage : les étapes et les séries sont regroupées par tenue puis par lieu (champs du lot c2), sans toucher à l'ordre de vente. Le temps estimé de la séance est la somme des durées hautes et d'un temps par photo, fixé dans le code.
- [ ] L'état « fait » est enregistré sur le serveur, jamais en local (ADR 0053), et repris sur un autre appareil.
- [ ] Relecture Extension : Nuit et Jour, 400 px, mouvement réduit, VoiceOver.

## Critères d'acceptation
- Tests : regroupement par tenue et lieu (étapes sans tenue à la fin, ordre de vente intact), temps estimé, reprise de l'état sur un second appareil.
- Captures téléphone montrées à Charles avant la fusion.

## Hors périmètre
Le dépôt des fichiers (SC-02, SC-03), la photo d'exemple (SC-08).

## Notes de session
