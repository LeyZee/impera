# 0118. Les rapports validés nourrissent le jeu du chatteur

Statut : accepted (« ok 0118 » de Charles le 16/11/2026, 01 h 16, après son choix « Il est repris » sur carte, étendu le même jour aux ventes remboursées : « pareil pour les remboursements »)
Date : 2026-11-16
Précise : ADR 0104 § 12 à § 16 (le jeu du chatteur), ADR 0108 (vitrine). Amende ADR 0104 § 15 et § 16 : un gain que le net corrigé ne justifie plus est repris.

## Contexte

La recette du 16/11/2026 (CHT-04) montre que le jeu ne lit que les ventes lues sur la plateforme. Or toute l'équipe travaille aujourd'hui en rapports déclarés : un chatteur avec trois rapports validés n'a ni trophée, ni net vers un rang, ni défi. Le jeu est vide pour tout le monde. Le même jour, Charles valide quatre règles pour que les rapports comptent. Deux autres anomalies touchent la même ADR : un rang reste affiché quand le propriétaire vide les seuils (EQU-04), et un palier reste dans la vitrine après un remboursement alors que les autres écrans disent qu'il reste à atteindre (CHT-11).

## Décision

1. **Deux sources, un seul net.** Le net d'un chatteur dans le jeu vient de ses ventes lues, comme aujourd'hui, et de ses rapports de fin de shift validés. Le net d'un rapport est celui que la chaîne de la paie donne à son montant (hors TVA, puis hors commission de la plateforme), dans la devise déclarée. Tout ce que le jeu calcule sur un net s'en nourrit : première vente, record du jour, record de quinzaine, palier atteint, net cumulé des rangs, défi du shift.
2. **Un rapport compte quand le manager le valide**, jamais à la déclaration. Il est rangé au jour de son shift : un rapport validé trois jours après compte pour le jour du shift, pas pour le jour de la validation.
3. **Une seule source par shift.** Si des ventes sont lues pour ce shift, le rapport de ce shift est ignoré par le jeu. Rien n'est compté deux fois. Dans le code : un rapport d'une quinzaine où la paie du compte lit les ventes ne compte pas (il est déjà « sans effet sur la paie », ADR 0084 § 3), et un rapport dont le shift contient une vente lue sur le même compte non plus (une vente lue sur un autre compte ne dit rien de ce shift : son rapport compte).
4. **Un rapport corrigé à la baisse retire le net qu'il avait donné**, comme une vente remboursée (un rapport validé ne se refuse plus, il se corrige, EQ-03 ; un rapport renvoyé avant sa validation n'a jamais compté, § 2) : le net cumulé vers le rang suivant, les records et le palier visé baissent d'autant.
5. **Un gain qui ne tient plus est repris** (choix de Charles, 16/11/2026 ; amende ADR 0104 § 15 et § 16). Quand le net baisse après coup, parce qu'un rapport validé est corrigé à la baisse ou parce qu'une vente lue est remboursée, et qu'un trophée lié à un net (première vente, record du jour, record de quinzaine, palier atteint) ou un rang n'est plus justifié par le net corrigé, il est retiré de la vitrine : un rang peut donc redescendre. Une seule règle pour les deux cas. La reprise est silencieuse (aucun dévoilement, aucune notification) ; si le chatteur le regagne, il est noté et dévoilé de nouveau, à sa nouvelle date. Aucune ligne n'est effacée : le gain repris garde sa ligne, datée, qu'aucun écran ne lit plus, et le gain regagné est une ligne nouvelle. Les trophées de régularité (séries, quinzaine sans retard) ne dépendent d'aucun net et ne sont pas concernés.
6. **« Dix PPV dans un shift » reste réservé aux ventes lues** : un rapport ne dit pas combien de PPV ont été achetés. Tant que les ventes du chatteur ne sont pas lues, la vitrine le dit sur ce trophée au lieu de le laisser muet.
7. **Seuils vidés ou relevés (EQU-04).** Régler les seuils n'est pas une correction du net : un rang déjà gagné reste affiché quand le propriétaire vide ou relève les seuils, et aucun nouveau rang ne s'ouvre sans seuil. Pour distinguer les deux cas, un rang garde le seuil auquel il a été gagné : il n'est repris que si le net cumulé repasse sous ce seuil-là et que le seuil du jour ne le donne plus. Un rang noté avant cette ADR, sans seuil connu, n'est jamais repris. Le texte du réglage le dit (« Sans seuil, aucun nouveau rang ne s'ouvre ; un rang déjà gagné reste. »). Ce seuil gardé sert aussi au dévoilement du rang, qui dit au chatteur lui-même le net qu'il vient de passer ; un rang noté avant que les seuils soient gardés garde l'ancienne phrase sans montant, et la vitrine lue par un autre que lui ne le porte jamais.
8. **Palier après une baisse du net (CHT-11).** Conséquence de la règle 5 : si le net corrigé repasse sous le palier, la médaille quitte la vitrine, et tous les écrans disent la même chose (« encore 10 € »). « Prime prévue » ne se lit que dans le relevé.
9. **Le jeu lit, il n'écrit pas.** Le module `rewards` lit les rapports validés par la porte de la paie et du planning, comme il lit déjà les ventes ; il n'écrit dans aucune de leurs tables et rien de ce qu'il note n'entre dans un relevé (§ 17, inchangé). Un chatteur ne lit que les siens (§ 1) ; le test d'isolation couvre la nouvelle lecture.
10. **« Mes chiffres » lit les mêmes lignes que le jeu** (accepté par Charles le 17/11/2026 avec le lot « mes-chiffres-rapports-2 »). La quinzaine jour par jour, la comparaison avec la quinzaine d'avant et les records de « Mes chiffres » comptent les rapports validés comme le jeu les compte (§ 1 à § 4) : un chatteur payé sur rapports voit enfin ses jours, et son record de l'écran est celui que le jeu fête. L'écran dit d'où vient le chiffre : un rapport validé est nommé « rapport validé », jamais ajouté au nombre de ventes, parce qu'un rapport donne un total et non ses ventes. « Quand je vends » ne lit que les ventes relevées : un rapport n'a pas d'heure de vente. Même lecture, mêmes droits : les siens seulement (§ 9).

## Conséquences

- Positives : le jeu vit dès aujourd'hui pour l'équipe, sans attendre la lecture des ventes ; le passage d'un compte aux ventes lues ne compte rien deux fois.
- Négatives : un net du jeu peut baisser après coup, et un trophée ou un rang déjà fêté peut disparaître ; le texte de la vitrine « ne redescend jamais » doit changer ; le jeu dépend de la rapidité de validation des managers.
- Une migration (`reward_gains`) : la date de reprise d'un gain, le seuil auquel un rang a été gagné, et la clé d'unicité limitée aux gains qui tiennent. Le job reste rejouable et reste le seul à reprendre un gain.
- Limite connue : un palier dont le propriétaire retire le seuil pendant la quinzaine en cours quitte aussi la vitrine, puisque le relevé ne l'atteint plus ; les quinzaines closes ne bougent pas.
- « Mes chiffres » (ADR 0104 § 1 à § 11) ne change pas ici : il lit toujours les ventes lues.

## Alternatives écartées

- Compter un rapport dès sa déclaration : un chatteur pourrait gagner un trophée sur un montant jamais validé.
- Garder ce qui est gagné quoi qu'il arrive (règle d'origine) : écarté par Charles le 16/11, un gain doit refléter un net réel.
- Attendre la lecture des ventes pour toute l'équipe : le jeu resterait vide pendant des semaines.
