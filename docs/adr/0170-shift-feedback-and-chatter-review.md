# 0170. Les retours de shift servent à l'IA, et l'IA relit les shifts des chatteurs pour un bilan de coach

Statut : accepted (« ok relecture des shifts » de Charles, 26/11/2026, après le brainstorm du même jour). Amendée le 26/11/2026 (§§ 20 à 25 : le retour léger, « ok rapport léger » de Charles ; §§ 26 à 32 : la carte de faute et les niveaux, « ok maquette bilan » de Charles)
Date : 2026-11-26
Précise : 0050 § 10 (le mini feedback), 0042 § 5 (les remontées lues par le topo de la créatrice), 0102 (la banque d'exemples), 0109 (la fiche du fan écrite depuis l'extension), 0025 (le chatteur chatte dans Reveal). Ne remplace rien.

## Contexte

1. Le retour de fin de shift (commentaire, incident, remontées) prévient le propriétaire d'un incident et s'arrête là : l'agent qui parle aux fans n'en apprend rien.
2. Les chatteurs écrivent aux fans dans Reveal avec leur propre compte membre (ADR 0025). Impera lit ces conversations, mais personne ne relit ce qu'ils écrivent : le propriétaire n'a pas le temps, et il n'y a pas encore de manager.
3. Sur chaque message côté créatrice, Reveal donne le nom du membre de l'équipe qui l'a écrit (`authorMessage.displayName`, lu par le connecteur). Impera ne le garde pas : un message humain est seulement `author = 'human'`.
4. Le dépôt est public. La méthode de chatting de l'agence, sa grille de relecture et ses règles de vente n'y entrent pas.

## Décision

### A. Les retours de shift

1. **Le code apporte les chiffres, le chatteur apporte le pourquoi.** Le panneau de retour affiche en lecture seule les ventes du shift, les brouillons de l'agent corrigés ou jetés et les passations. Quand il a corrigé beaucoup de brouillons, une question à choix fermés demande pourquoi.
2. **« Lier à un fan »** sur une remontée : le fan est choisi dans la liste de son shift, jamais tapé. Deux catégories de remontée en plus : l'agent, une idée. « Rien à signaler » reste en un geste.
3. **Tri automatique** de chaque retour en cases fermées (un fan, la créatrice, l'agent, l'outil, l'équipe), par la passerelle LLM avec un schéma de sortie Zod. Le texte du chatteur est une donnée non fiable, dans un bloc délimité (règle 4 de `CLAUDE.md`) ; il n'entre jamais tel quel dans un prompt de conversation.
4. **Ce qui touche un fan** entre tout de suite dans sa fiche, marqué « par un chatteur », avec le droit d'écriture du chatteur pendant son shift (ADR 0109).
5. **Ce qui touche la créatrice ou l'agent** devient une proposition d'ajustement (un réglage, un script, une consigne, un exemple), avec ses preuves, que le propriétaire applique ou ignore. Un retour ne change jamais seul un prompt ni une règle de code. Seul le propriétaire valide un réglage de vente ; un manager peut traiter un manque de contenu.
6. **Remontées.** L'urgent sonne tout de suite (incident, sécurité d'un fan). Un même sujet signalé par deux chatteurs, ou trois fois en sept jours, remonte sans attendre. Le reste va dans le point du lundi. Il n'y a pas de résumé quotidien.

### B. L'agent relit les shifts des chatteurs

7. **Auteur de chaque message.** Impera garde le nom du membre Reveal sur chaque message humain et le rattache au chatteur relié (ADR 0050 § 5). Un nom inconnu, ou porté par deux membres, rend le message « non attribué » : il n'est jamais compté contre personne.
8. **Trois couches.**
   - Les gardes du code, rejouées sur chaque message humain : sans appel au modèle, objectives.
   - Une relecture par le modèle de chaque conversation du shift, contre la grille de l'agence et la fiche courte de la persona.
   - Le bilan, écrit seulement à partir de ces relectures et des chiffres calculés par le code. Un chiffre que le modèle écrirait sans l'avoir reçu est refusé.
9. **La grille vit en base, pas dans le dépôt.** Une remarque cite sa règle par un code générique (par exemple `rule.example_1`). Le libellé lisible et la règle elle-même sont saisis hors dépôt, en base. Les tests utilisent des règles et des phrases inventées.
10. **Jugé sur les règles, jamais sur le style.** Un chatteur n'est jamais comparé à ce que l'agent aurait écrit, ni aux autres chatteurs. La forme de ses messages ne compte jamais dans un dossier : elle peut seulement apparaître comme un conseil.
11. **Ventes faites et manquées.** Une occasion manquée n'est relevée que là où des signaux lus par le code montrent qu'une vente était possible. Chaque remarque cite la règle qui la fonde.
12. **Le bilan.** C'est une page dans l'espace du chatteur, lue le même jour que le propriétaire. Il y trouve :
    - ses chiffres face à sa période précédente ;
    - au plus trois points à travailler, chacun avec l'extrait de conversation redessiné depuis la base (jamais une capture, pseudos masqués), la phrase en cause, une note pédagogique et une réponse possible à la place ;
    - ce qui est bien fait ;
    - ses progrès.

    Aucun compliment n'est forcé : un bilan sans rien de bon le dit.
13. **Rythme.** Un nouveau chatteur a deux semaines d'accompagnement, avec un court bilan après chaque shift. Ensuite, un bilan par semaine.
14. **Contester.** Le chatteur conteste un point en une ligne, et le manager tranche. Un point contesté ne compte pas tant qu'il n'est pas tranché.
15. **Dossier « à examiner ».** Il s'ouvre tout de suite pour une fraude ou un problème de sécurité. Pour une autre faute, il s'ouvre quand la même revient trois fois en deux semaines après avoir été expliquée dans un bilan. Pendant l'accompagnement, seuls la fraude et la sécurité en ouvrent un. L'agent ne pose jamais de malus : un humain décide (le malus est permis au manager).
16. **Primes.** Quand un chatteur n'a rien à se faire reprocher et dépasse les attentes, l'agent propose une prime au propriétaire, avec ses preuves. Le propriétaire décide seul.
17. **Exemples.** Une réponse de chatteur qui apprend vraiment quelque chose peut être proposée comme exemple. Le propriétaire la valide avant qu'elle entre dans la banque de la créatrice (ADR 0102) ou dans les guides. Elle reste anonyme pour les autres chatteurs.
18. **Transparence.** Les chatteurs sont prévenus, dans leur contrat et dans l'app, que leurs conversations avec les fans sont relues, pour le suivi et pour les aider. Rien d'autre n'est relu : ni le temps d'inactivité, ni les clics. La commission n'apparaît jamais dans l'extension.
19. **Tout est relu**, pas un échantillon.

## Conséquences

- Positives : le chatteur reçoit un retour régulier, précis et vérifiable. Le propriétaire ne lit plus que ce qui demande son attention. L'agent apprend des retours par la fiche du fan et par des ajustements validés, jamais en silence.
- Négatives : une dépense de modèle par shift. Elle est estimée à environ 2 centimes par conversation, soit environ 50 centimes pour un shift de 30 conversations, plus environ 15 centimes par bilan hebdomadaire. Elle sera mesurée sur un premier shift réel et annoncée avant le premier passage. Le module `agent` lira des conversations écrites par des humains, sans y répondre.
- À surveiller :
  - Un bilan trop sévère ou trop générique. Les contestations tranchées en faveur du chatteur servent de mesure.
  - Un nom de membre Reveal changé en cours de période : les messages concernés passent en « non attribué ».

## Mise en œuvre

- Migration 0272 : le nom du membre Reveal sur le message humain et son rattachement au chatteur.
- Migration 0273 : les relectures, les bilans, les dossiers et les contestations, en FORCE RLS, `REVOKE ALL`, `GRANT` explicites, `impera_service` en SELECT seul.
- Les jobs passent par des tâches nommées sous `withTenantJob`. Aucun plafond nouveau du rôle de service sans l'accord de la relecture de sécurité.
- Les écrans (bilan du chatteur, propositions du lundi) attendent le feu vert du propriétaire sur maquette.

## Alternatives rejetées

- **Comparer le chatteur à la réponse de l'agent** : ça impose un style. Chaque chatteur garde sa manière d'écrire.
- **Relire un échantillon** : moins cher, mais injuste, parce qu'une faute dépend alors du tirage.
- **Des captures d'écran des conversations** : ce sont des images de données réelles à stocker et à protéger, alors que l'extrait redessiné depuis la base suffit.
- **Laisser l'agent poser le malus** : refusé, un humain décide toujours.
- **Mettre la grille dans les prompts versionnés** : le dépôt est public.

## Amendement du 26/11/2026 : le retour léger

Charles a validé la maquette le 26/11, puis demandé un retour obligatoire qui ne s'accumule pas et ne contraint pas trop (« ok rapport léger », 26/11/2026). Il a choisi sur carte, le même jour, que le rapport avec montant n'est pas concerné. Cet amendement précise le § A et l'ADR 0050 § 10 : le mini feedback n'était jusqu'ici ni demandé ni rappelé.

20. **Il ne sert qu'à ce qu'Impera ne voit pas** : ce qui s'est passé hors du chat, un souci de la plateforme, l'agent qui déraille, une idée. Les chiffres du shift sont lus par le code et montrés en lecture seule (§ 1) ; la qualité vient de la relecture (§ B).
21. **Trente secondes au plus.** Tout est pré-rempli. « Rien à signaler » se fait en un geste, les catégories et les fans se choisissent, le texte libre est facultatif.
22. **Demandé à la prise de poste.** « Je prends mon poste » est refusé tant que le retour du shift précédent manque (`shift_check_in_feedback_due_conflict`, avec le shift en cause), et l'écran l'ouvre tout de suite. Le retour reste possible dès 30 minutes avant la fin du shift.
23. **Un seul retour en attente.** Seul le dernier shift ouvert d'un membre prend un retour. Dès qu'un shift plus récent ouvre le sien, le précédent expire : il est refusé (`shift_feedback_expired_conflict`), compté « sans retour » dans Équipe › Rapports pour le propriétaire et les managers, et ne se rattrape jamais. Rien ne s'enlève de la paie.
24. **Le rapport avec montant ne change pas.** Sur un compte dont la paie lit les rapports (source « déclarée »), le rapport de fin de shift garde son bouton et ses deux rappels (ADR 0077) : la paie le lit, il n'expire pas.
25. **Lier à un fan** écrit la phrase dans sa fiche comme la note de « Rendre la main » (fait `operator_note`, avec son auteur), par la tâche des conversations, une fois par remontée.

## Amendement du 26/11/2026 : la carte de faute et les niveaux

Le 26/11 au soir, Charles a lu les vraies conversations de ses chatteurs analysées par Impera. Il a demandé un bilan qui relève tout ce qui nuit à l'achat ou à la relation, avec un retour constructif, et un ton plus ferme sur ce qui se répète ou qui est grave (« il faut vraiment coder ça »). Il a choisi sur carte d'afficher le manque à gagner en euros au chatteur, puis d'être alerté dès la première fois pour une sortie de plateforme. Il a validé la maquette (« ok maquette bilan ») et le catalogue des fautes avec leurs niveaux le même soir. Cet amendement précise les §§ 11, 12 et 15.

26. **Une carte par faute.** Elle montre, dans cet ordre : son niveau, ce qu'elle a coûté, l'extrait redessiné, ce que le fan a ressenti à ce moment-là, « comment tu aurais pu la mener » en deux ou trois messages réécrits dans la voix de la créatrice, et la règle. Un point bien fait montre ce qu'il a rapporté, au même endroit. Les messages réécrits ne recopient jamais ceux du fan.
27. **Le manque à gagner est montré en euros au chatteur**, sur chaque carte et en total du shift ou de la semaine. Il est calculé par le code au prix de l'étape suivante du script en cours, jamais écrit par le modèle. Quand il ne se chiffre pas (une promesse faite au nom de la créatrice), la carte dit ce qui est en jeu à la place. La commission n'apparaît jamais.
28. **Quatre niveaux, fixés par le code de la faute.** Chaque faute a un code neutre. Son libellé et son niveau sont saisis hors dépôt, en base, comme la grille (§ 9). Le modèle ne choisit pas le niveau, et un niveau peut dépendre d'un fait lu par le code.
    - 0 : un conseil, jamais compté.
    - A : la règle du § 15. La première fois, une explication. Ensuite, un rappel ferme. À trois fois en deux semaines après l'explication, un dossier.
    - B : une remarque ferme dès la première fois. Un dossier à la deuxième fois en deux semaines.
    - C : un dossier pour le propriétaire dès la première fois, comme une fraude ou un problème de sécurité.
29. **Le compteur est celui du code.** Une occurrence ne compte qu'une fois la faute expliquée au chatteur dans un bilan. Une occurrence contestée ne compte pas tant qu'elle n'est pas tranchée. Pendant les deux semaines d'accompagnement, seul le niveau C ouvre un dossier.
30. **Le ton suit le niveau et le compteur**, jamais le prompt : gris pour une explication, ambre pour un rappel ferme, rouge pour une faute grave.
31. **Rythme.** Le bilan hebdomadaire relit toutes les conversations de la semaine (§ 19). Pendant l'accompagnement, un court bilan suit chaque shift.
32. **Partage du travail.** Le module `agent` relit les conversations et produit les remarques par occurrence, avec le code de la faute. Le module `team` garde les niveaux, compte les occurrences, ouvre les dossiers, reçoit les contestations et rend « Mon bilan ». Il lit les remarques par l'`index.ts` de l'agent.
