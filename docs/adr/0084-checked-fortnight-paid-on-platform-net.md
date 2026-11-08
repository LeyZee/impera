# 0084. La quinzaine vérifiée peut être la première payée sur les ventes Reveal

Statut : accepted (« ok 0084 » de Charles le 08/11/2026, 16 h 46, chat du projet ; « ok novembre-reveal » le 08/11/2026, 16 h 29, fil Équipe : la paie de novembre se calcule sur les ventes Reveal ; numéro attribué par le coordinateur)
Date : 2026-11-08
Amende : l'ADR 0050 § 8, pour deux phrases : « posée à une frontière de période et jamais rétroactive » et « sur une quinzaine passée couverte par le registre […] La bascule se fait ensuite à une frontière de période ». Amende aussi la règle de départ des règles de paie (EQ-03 : de nouvelles règles partent d'une quinzaine qui n'a pas commencé). Ne change ni la vérification (CRM-02, `isCleanMatch`), ni le calcul (CRM-03), ni l'attribution d'une vente (ADR 0050 § 5).

## Contexte

Le 07/11, Charles a répondu qu'il ne veut les ventes Reveal qu'« à partir du 01 novembre ». Avec les règles d'aujourd'hui, novembre ne peut pas être payé sur ces ventes :

- Un compte ne passe en source « détectée » qu'après une vérification propre (ADR 0050 § 8, CRM-02). Elle doit porter sur une quinzaine entière, finie et couverte par le registre.
- Le registre commence le 23/10. La quinzaine du 16 au 31 octobre ne peut donc pas sortir propre (`register_starts_after`).
- La première quinzaine vérifiable est celle du 1er au 15 novembre, au plus tôt le 16.
- Les règles qui basculent doivent partir d'une quinzaine qui commence après la fin de la vérification. Elle ne doit pas avoir commencé non plus. La bascule arriverait donc le 1er décembre.

Le 08/11, Charles a choisi que novembre soit payé sur les ventes Reveal (« ok novembre-reveal »).

Le § 8 demande que Charles voie le net concorder avant qu'on paie. Or une quinzaine n'est payée qu'à sa clôture, qui vient après sa fin. Vérifier cette quinzaine elle-même, une fois finie et avant sa clôture, garde cet ordre.

## Décision

**1. La quinzaine vérifiée peut être la première basculée.** Les règles d'un compte en source « détectée » peuvent partir de la quinzaine de la dernière vérification de sa plateforme, si cette vérification est propre (`isCleanMatch`). Aujourd'hui, elles ne peuvent partir que d'une quinzaine qui commence après la fin de la vérification. Cela reste possible.

**2. Seulement tant que rien n'est payé.** Ces règles peuvent partir d'une quinzaine commencée, ou même finie. Il faut pour cela qu'aucune quinzaine ne soit clôturée à partir de celle-là (`pay_period_closings`). Une quinzaine clôturée ne change jamais de base ni d'`inputs_hash`, comme aujourd'hui. Toute autre règle de paie garde la règle actuelle : elle part d'une quinzaine qui n'a pas commencé, ou de celle en cours pour les premières règles d'un compte.

**3. Ce qui change dans une quinzaine basculée après coup.**

- Elle est payée sur les ventes lues, attribuées selon l'ADR 0050 § 5 : la vente va au chatteur relié qui était en poste, ou dans sa marge, à l'heure de la vente.
- Ses rapports de fin de shift restent, mais leurs ventes déclarées ne comptent plus dans la paie.
- Ses brouillons de relevés changent : le recalcul de chaque quinzaine touchée est lancé dès que les règles sont posées.
- Le mini feedback (§ 10) ne vaut que pour les shifts qui suivent : rien n'est demandé après coup.

**4. Une seule règle par compte et par quinzaine, comme aujourd'hui.** Si le compte a déjà des règles qui partent de la quinzaine vérifiée, la bascule part d'une quinzaine suivante.

**5. La bascule reste un geste du propriétaire, dans le CRM.** Le choix « Ventes relevées » s'ouvre dans la fenêtre des règles de paie (Réglages › Règles de paie). La fenêtre propose la quinzaine vérifiée quand elle peut basculer. Sinon, elle dit pourquoi : modèle à relier, vérification à lancer, ou quinzaine déjà clôturée.

## Pour novembre

Voici l'état de la base de Charles le 08/11, lue sans rien écrire :

- un compte Reveal ;
- aucune règle de paie ni clôture ;
- aucun shift en novembre ;
- aucun chatteur relié ;
- aucune vérification.

Le CRM est arrêté depuis le 06/11 au soir. Le registre rattrapera les ventes depuis son curseur au prochain démarrage.

1. Relancer le CRM, pour que les ventes de novembre soient lues.
2. Relier les chatteurs dans Réglages › Ventes › Équipe Reveal, et le compte « bot » à l'agent s'il y en a un.
3. Saisir au planning les shifts de novembre. Sans eux, chaque vente attend « hors poste » et se compte une à une dans Paie › Quinzaine › Ventes en attente.
4. Le 16/11, lancer la vérification de fiabilité du 1er au 15 novembre (Réglages › Ventes), avec l'export du dashboard Reveal de ces jours-là.
5. Si elle est propre, poser les règles du compte Reveal en source « Ventes relevées », à partir de la quinzaine du 1er novembre. La quinzaine du 16 au 30 suit les mêmes règles.
6. Valider les relevés du 1er au 15 : la première validation clôture la quinzaine.

Si la vérification du 1er au 15 n'est pas propre, la même règle permet de basculer à partir du 16. Il faut alors une vérification propre du 16 au 30.

## Mise en œuvre

- `scheduling` : la garde de bascule (`assertSourceSwitchable`) et la règle de départ (`assertRulesStart`) acceptent la quinzaine vérifiée.
  - Le fait « une quinzaine est clôturée à partir de celle-là » vient de `payroll`, câblé par la racine de composition et lu dans la transaction des règles.
  - Poser des règles qui partent d'une quinzaine commencée met en file `payroll.recalculate` pour chaque quinzaine touchée, jusqu'à celle en cours.
- Contrat : une raison de refus de plus, `period_closed`, dans `PAY_RULES_SOURCE_REFUSALS`.
  - La liste des règles donne, par compte, la quinzaine vérifiée qui peut basculer (`checkedPeriod`, `null` sinon).
  - Le message de `check_not_before` dit « cette quinzaine ou une quinzaine qui finit avant ces règles ».
- Écran : « Ventes relevées » est ouvert dans la fenêtre des règles de paie. Avec ce choix, les quinzaines proposées sont la quinzaine vérifiée et celles qui n'ont pas commencé.
- Aucune migration.

## Conséquences

Positives :

- Novembre est payé sur le chiffre de Reveal, sans attendre décembre.
- La vérification porte sur la quinzaine même qui sera payée.

Négatives, à surveiller :

- Une quinzaine basculée après coup ignore les ventes déclarées de ses rapports. Un chatteur qui en avait saisi voit son relevé changer.
- Tant que les shifts de novembre ne sont pas au planning, les ventes attendent une décision du valideur.
- Le remboursement d'une vente d'avant la bascule n'a que « Écarter », comme aujourd'hui (CRM-03 lot b3). Après une bascule au 1er novembre, c'est le cas d'une vente faite entre le 23 et le 31 octobre.

## Alternatives écartées

- **Basculer le 1er décembre**, avec les règles d'aujourd'hui : novembre serait payé sur les rapports, ce que Charles n'a pas choisi.
- **Basculer sans vérification** : contraire au § 8, Charles n'aurait pas vu le net concorder avant de payer.
- **Vérifier seulement du 23 au 31 octobre** : une vérification sur une quinzaine incomplète n'est jamais propre, et l'accepter affaiblirait la garde pour tous les comptes.
