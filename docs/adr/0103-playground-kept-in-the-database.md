# 0103. Le playground en base : conversations, notes, cas rejouables, taux par version, calibrage du désir

Statut : accepted (« ok 0103 » de Charles, 12/11/2026 ; demande du même jour après l’avis sur le playground, recommandations 3, 4, 5 et la note de désir)
Date : 2026-11-12
Précise : l'ADR 0019 (taux au playground) et l'ADR 0022 (la persona fait partie de la version). Ne remplace rien.

## Contexte

Le playground garde sa conversation en mémoire (un redémarrage la perd), ses notes dans un fichier du PC (`ratings.jsonl`, hors base et hors sauvegarde), et rien ne relit les notes « règle » ou « test ». Son taux est compté par prompt et modèle de voix, pas par version de persona : passer de la 2.0.0 à la 2.0.1 ne dit pas si c'est mieux. Enfin la note de désir (P3-12) est calculée à chaque message avec des poids « à calibrer », mais personne ne peut dire quand elle se trompe.

## Décision

1. **Les conversations du playground sont en base.** Une conversation appartient au propriétaire qui l'a jouée, à une créatrice et à une version de persona (ou à la persona fictive). Elle survit à un redémarrage, se reprend, se rejoue. Elle garde l'horloge simulée et la mise en situation.
2. **Les notes sont en base.** Validé, corrigé, rejeté (avec sa raison), et leur destination, rattachés au message noté, à la version de persona, au prompt et au modèle de voix. Au premier démarrage, le fichier `ratings.jsonl` du PC est importé une fois, puis renommé ; rien à faire à la main.
3. **« En faire un test ».** Sur une réponse ratée, le propriétaire écrit en une phrase ce qui devait se passer (« elle refuse la remise sans citer de prix », « elle ne propose rien, il est au travail »). Le moment est gardé tel quel : la conversation jusqu'au message du fan, la situation, la créatrice. C'est un cas rejouable, en base, jamais dans le dépôt.
4. **« Rejouer les cas ».** Sur une version de persona, un bouton rejoue tous les cas de la créatrice par le même chemin que la prod. Le juge des évals lit la phrase attendue et dit passé ou raté ; le propriétaire peut renverser son avis. Le coût estimé est affiché avant de lancer et compte dans le budget IA du jour.
5. **Le taux au playground est compté par version de persona**, en plus du prompt et du modèle de voix. « Comparer deux versions » rejoue les mêmes messages du fan d'une conversation sur une autre version de la créatrice, côte à côte ; la conversation d'origine ne change pas.
6. **Le calibrage du désir.** Sous chaque message du fan, la note de désir s'affiche avec les signaux qui l'ont fait bouger et leurs points. Le propriétaire peut marquer « trop haute », « trop basse » ou « juste », avec un mot s'il veut. La marque garde la lecture complète (signaux, mesure, version des poids). Les poids restent dans le code (règle 3 de CLAUDE.md) : on les change dans une PR, avec une nouvelle version des poids, et un écran montre, pour chaque marque, la note avec l'ancienne et la nouvelle version.
7. **Isolation.** Chaque table nouvelle porte `creator_id`, en FORCE RLS ; les routes nouvelles entrent au harnais d'isolation. La persona fictive n'appartient à aucune créatrice : ses conversations et ses notes ne sont pas gardées, elle sert à découvrir l'écran.
8. **Conservation.** Conversations, notes, cas et marques restent jusqu'à ce que le propriétaire les supprime. Ils entrent dans la sauvegarde de la base comme le reste.

## Conséquences

- Positives : on peut prouver qu'une version fait mieux que la précédente, sur les mêmes cas ; un raté vu une fois ne revient plus en silence ; la note de désir devient corrigeable.
- Négatives : deux à quatre tables de plus, une migration, et le playground devient une vraie fonctionnalité à maintenir.
- À surveiller : le coût des rejeux (chaque cas coûte un tour complet). Avec 50 cas, un rejeu coûte de l'ordre d'un euro.

## Alternatives rejetées

- **Garder le fichier JSONL.** Hors sauvegarde, illisible depuis le CRM.
- **Mettre les cas dans `evals/` du dépôt.** Le dépôt est public, et un cas contient la voix réelle de la créatrice.
- **Laisser le juge seul décider des cas.** Grok note Grok ; le propriétaire garde le dernier mot.
