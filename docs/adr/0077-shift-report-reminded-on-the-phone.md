# 0077. Rapport de fin de shift : Impera le rappelle au chatteur sur son téléphone

Statut : accepted (Charles, 06/11/2026, 19 h 10, « ok 0077 » ; « ok rappel-double » et « ok rappel-de-nuit » 18 h 55 ; relecture de Bilan intégrée)
Date : 2026-11-06
Précise : l'ADR 0042 § 7 (notifications push, heures calmes, plafond), l'ADR 0023 (le rapport de fin de shift), l'ADR 0073 § 5 (aucune notification d'écart hors du CRM, inchangé).

## Contexte

Le 06/11, Charles a demandé comment se joue un rapport de fin de shift, puis « attaque ça » (18 h 51) sur ce qui manque : un rappel automatique au chatteur. Il a choisi deux rappels, le premier même la nuit (« ok rappel-double », « ok rappel-de-nuit », 18 h 55). Aujourd'hui :

- le bouton « Faire mon rapport » s'ouvre 30 minutes avant la fin du shift, sur Aujourd'hui ;
- rien ne prévient le chatteur qui l'oublie : l'agence voit « N shifts sans rapport » sur Équipe › Rapports, et « Relancer » copie un message qu'elle colle elle-même (EQ-15) ;
- un rapport en retard n'est jamais refusé, mais il retarde la validation et peut glisser sur la quinzaine suivante (ADR 0032).

Les notifications push de l'application installée existent (CR-01, module `notifications`) : appareils, heures calmes (22 h – 8 h par défaut), plafond de 6 par jour, un envoi une seule fois par compte, raison et objet. Seul le début de son propre shift passe les heures calmes (glossaire). Aucun module ne s'en sert encore pour les shifts.

## Décision

**1. Ce qui déclenche un rappel.** Un shift fini, non annulé, dont le membre n'a pas envoyé de rapport, sur un compte dont la quinzaine est en source « déclarée » avec ses règles de paie. Pas de rappel :

- en source « détectée » : le mini feedback y est facultatif (ADR 0050 § 10), rien n'est dû ;
- sans règles de paie pour la quinzaine : le rapport serait refusé (`pay_rules_missing_conflict`), le rappel ne servirait à rien ;
- à un membre parti ;
- pour un rapport renvoyé ou un écart avec Reveal : l'ADR 0073 § 5 garde tout dans le CRM.

**2. Quand : deux rappels** (Charles, 06/11, 18 h 55, « ok rappel-double »).

- Premier rappel : 15 minutes après la fin du shift (heure du shift arrêté plus tôt, s'il l'a été), si aucun rapport n'est envoyé. Il ne part que tant que le shift est fini depuis 2 h au plus : un worker arrêté quelques heures (déploiement, panne) ne fait jamais sonner la nuit un shift fini la veille au soir. Passé 2 h, c'est le second rappel qui prévient.
- Second rappel : 12 heures après la fin, si le rapport manque toujours. Il suit les heures calmes et le plafond comme tout rappel.
- Ensuite, plus rien : la liste « Sans rapport » et « Relancer » restent à l'agence.

**3. Le premier rappel passe les heures calmes** (Charles, 06/11, 18 h 55, « ok rappel-de-nuit »), comme le début de son propre shift : le chatteur vient juste de travailler, et un shift de nuit qui finit à 5 h a son rappel à 5 h 15, pas à 8 h. Il ne compte pas dans le plafond quotidien. Le second rappel, lui, attend la fin des heures calmes et compte dans le plafond.

**4. Le message.** Sur l'écran verrouillé, rien qui nomme la créatrice ni un fan (ADR 0020) :

- « Rapport de fin de shift » — « Ton shift de 23 h – 5 h est fini : fais ton rapport. »
- second rappel : « Ton rapport du shift d'hier, 23 h – 5 h, n'est pas encore fait. »

Les heures sont celles de la fiche du membre (son fuseau, comme Aujourd'hui et Mon planning). Un appui ouvre Aujourd'hui, où le bouton du rapport attend.

**5. Une seule fois.** L'objet de chaque rappel est le shift et son rang (`shift-report:<shift>:1`, `:2`) : un job rejoué, deux lectures ou deux workers ne font jamais sonner deux fois. La clé unique de `notify` est (compte, raison, objet) ; chaque objet a une seule raison (`:1` toujours `own_shift_end`, `:2` toujours `reminder`), donc c'est l'objet qui dédoublonne, jamais la raison. Un rapport envoyé entre la lecture et l'envoi ne fait rien sonner : le job relit le shift juste avant d'appeler `notify`.

## Conséquences

- **Job** `scheduling.remind_reports`, toutes les cinq minutes (`crontab.ts`, sans rattrapage), sur la connexion admin : les shifts finis depuis 15 minutes à 2 h (premier rappel) ou depuis 12 h à 14 h (second), sans rapport, lus par pages. Il appelle `notify` du module `notifications`, donné par le composition root (comme `creator_tasks.remind`). Aucune table nouvelle : l'idempotence est celle de `notify`.
- **Notifications** (relecture Bilan, 06/11) : une raison nouvelle, `own_shift_end`, pour le premier rappel seulement ; le second prend la raison `reminder`. Dans `policy.ts`, un seul ensemble `PASSES_QUIET_HOURS` (`own_shift_start`, `own_shift_end`), lu par `isCapped` et par `decideNotification`, pour que les deux exceptions ne divergent jamais ; un test vérifie qu'`own_shift_end` sonne en heures calmes et ne compte pas dans le plafond. Le glossaire « Heures calmes » dit l'exception nouvelle.
- **Aucun écran nouveau.** Le chatteur active les notifications depuis le menu de son compte, comme aujourd'hui ; sur iPhone, seulement dans Impera installée. Sans appareil abonné, rien ne sonne, et « Relancer » reste.
- **Tests** : la règle (pur), le job contre la base (Testcontainers) avec shift annulé, rapport envoyé au dernier moment, source détectée, règles absentes, membre parti, rejoué.

## Options écartées

- **Telegram au chatteur** : le bot Telegram parle à l'agence, et Charles veut les rappels du téléphone dans l'application (CR-01), pas sur Telegram.
- **Rappel avant la fin du shift** : le chatteur est encore en poste, et le bouton s'ouvre déjà 30 minutes avant.
- **Prévenir l'agence par push** : la liste « Sans rapport » et « Relancer » suffisent ; une alerte d'agence se décidera à part si le besoin se voit.
