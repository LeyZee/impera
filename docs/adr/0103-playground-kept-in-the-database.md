# 0103. Le playground en base : conversations, notes, cas rejouables, taux par version, calibrage du désir

Statut : accepted (« ok 0103 » de Charles, 12/11/2026 ; demande du même jour après l’avis sur le playground, recommandations 3, 4, 5 et la note de désir). Amendée le 13/11/2026 (« ok phrases 0103 » : la disponibilité du fan, porte avant le premier teaser, texte corrigé validé à 1 h 07 ; puis les ventes fictives, « ok phrases 0103 » à 1 h 10 ; puis l'écran « Leçons », « ok phrases 0103 » à 1 h 30).
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

## Amendement du 13/11/2026 : la disponibilité du fan

Charles, 13/11 : la note de désir doit dire si le fan est en état de recevoir une vente, pas seulement s'il sexualise. Il doit être seul, chez lui, libre un moment. Avant cet amendement, seul « occupé » (`busy_now`, −30) en tenait compte, et rien n'empêchait une étape payante de partir sans que ce soit su. Avis du fil Agent (ADR 0098) repris.

9. **Signaux.** Le cerveau repère, dans la liste fermée de ses signaux, « il est seul », « il est chez lui », « il est libre un moment, sans rendez-vous » (positifs) et « quelqu'un à côté », « il a un rendez-vous ou doit partir », distincts de « occupé » (négatifs). Il ne fait que repérer ; il ne décide rien.
10. **La disponibilité du fan est un état tenu par le code** : confirmée, inconnue ou non. Elle est confirmée quand il a dit être seul et libre, passe à « non » sur un signal négatif, et redevient inconnue au bout de 2 h ou à la fin de la session, la première des deux. Une confirmation de la veille ne vaut jamais pour aujourd'hui. Elle est une lecture d'entrée de l'agent, comme la note de désir : une seule source, que le déroulé de script (ADR 0098) et le playground lisent.
11. **La porte est avant le premier teaser** (correction de Charles, 13/11 : un teaser envoyé gâche le script, qui ne se rejoue pas). Aucun script ne démarre, teasing offert compris, sans les trois conditions réunies : sa note de désir au seuil du script ; il sexualise déjà lui-même dans cette session (au moins un signal de sexualisation venu de ses messages, pas de ceux de la créatrice) ; sa disponibilité confirmée. Tant qu'une condition manque, `nextScriptStep` attend, avec la condition manquante pour raison.
12. **Un « non » après le démarrage met le script en pause** : aucune étape envoyée, aucun refus compté. Le script ne reprend que dans la même session (ADR 0098).
13. **La question vient du code.** Quand il est chaud et sexualise mais que sa disponibilité est inconnue, le code donne au cerveau la consigne de s'en assurer naturellement (« t'es tranquille là ? »), avant tout teaser. La consigne est donnée une fois par session au plus : un fan qui ne répond pas ne se la voit pas reposer à chaque message.
**Précisions du fil Agent** (au codage de la porte, « ok phrases 0103 » à 1 h 53) : la disponibilité est confirmée quand il a dit être seul ET libre, dans un ou deux messages de la même session ; « chez lui » seul ne suffit pas, et un signal négatif l'emporte dans le même message. « Il sexualise » veut dire du sexto, de l'excitation, ou qu'il amène lui-même l'intime, dit son envie, parle cru, joue un rôle, demande son corps ou réagit chaudement à un média ; un simple flirt ne compte pas. La session est la session chaude de l'ADR 0098 : elle se termine quand la note retombe sous le seuil, et dure 2 h au plus. La porte ferme aussi une offre libre hors script : aucune vente sans les trois conditions ; les gardes existantes (délai entre offres, risque) passent avant.

14. **Au playground**, une ligne « Disponible : confirmée / inconnue / non » s'affiche à côté de la note de désir, avec ce qui l'a fixée, et la porte dit laquelle des trois conditions manque, pour calibrer comme le reste.

## Amendement du 13/11/2026 : les ventes fictives

Charles, 13/11 : au playground, elle doit pouvoir vendre pour de faux, scripts et médias compris, pour voir comment et à quel moment elle vend. Avant cet amendement, le playground savait décider une offre et laisser le propriétaire jouer un média envoyé, mais il n'y avait ni script, ni prix, ni achat. Avis du fil Agent (ADR 0098) repris.

15. **Elle joue les vrais scripts, par les mêmes règles.** Une fois le déroulé de script de l'ADR 0098 sur `main`, le playground joue les scripts de la créatrice choisie, lus comme en production (coffre synchronisé de l'ADR 0099 ou scripts écrits dans l'outil), ou ceux de la persona fictive. Il appelle les mêmes fonctions du domaine que la production (porte de démarrage, étape suivante, rapprochement) : aucune règle recopiée côté playground. Il n'appelle jamais Reveal.
16. **Le fan peut payer pour de faux.** Chaque étape payante arrive floutée, avec le prix de l'étape, et deux boutons : « Payer (fictif) » et « Refuser ». Payer débloque le média, ajoute le montant à « déjà dépensé » et laisse le script avancer. Refuser vaut un refus explicite. Ignorer l'étape se joue en écrivant d'autres messages, et c'est le compteur du domaine qui en décide, pas un bouton.
17. **Rien ne sort.** Aucun argent ne bouge, aucune vente n'est enregistrée hors du playground, rien n'est envoyé à une plateforme. Le déroulé d'une session de playground vit dans les tables du playground, jamais dans celles des conversations réelles ; le domaine y accède par un port à deux adaptateurs, la production et le playground. Tout ce qui est payé est marqué « fictif » à l'écran.
18. **« Pourquoi » dit où en est le script** : quel script, quelle étape, pourquoi elle a envoyé à ce moment-là, ou pourquoi elle attend (dont la condition de la porte qui manque).

## Amendement du 13/11/2026 : l'écran « Leçons »

Relecture design (ADM-11) : une leçon gardée au playground n'est relue nulle part, et une leçon « règle » est perdue.

19. **Entraîner a un écran « Leçons », par créatrice, en trois onglets.** Exemples de voix (la banque de l'ADR 0102, avec « Retirer ») ; cas à rejouer (avec le résultat du dernier rejeu) ; règles proposées, chacune « à coder », « codée » ou « écartée », que seul le propriétaire change. Une règle proposée n'agit jamais d'elle-même : elle attend d'être codée (règle 3 de CLAUDE.md). Chaque leçon gardée au playground donne un lien « Voir dans Leçons ».

## Conséquences

- Positives : on peut prouver qu'une version fait mieux que la précédente, sur les mêmes cas ; un raté vu une fois ne revient plus en silence ; la note de désir devient corrigeable.
- Négatives : deux à quatre tables de plus, une migration, et le playground devient une vraie fonctionnalité à maintenir.
- À surveiller : le coût des rejeux (chaque cas coûte un tour complet). Avec 50 cas, un rejeu coûte de l'ordre d'un euro.

## Alternatives rejetées

- **Garder le fichier JSONL.** Hors sauvegarde, illisible depuis le CRM.
- **Mettre les cas dans `evals/` du dépôt.** Le dépôt est public, et un cas contient la voix réelle de la créatrice.
- **Laisser le juge seul décider des cas.** Grok note Grok ; le propriétaire garde le dernier mot.
