# 0073. Rapport déclaré sur Reveal : l'écart avec les ventes lues se voit, s'explique et se tranche par un humain

Statut : proposed (à accepter par Charles : « ok 0073 »)
Date : 2026-11-06
Remplace : dans l'ADR 0043 § 4, pour le rapport d'un compte Reveal en source « déclarée », le paragraphe « Dès que le connecteur lit les ventes de Reveal » (seuils de 5 % et 10 €, rapprochement ligne par ligne, ambre « écart »).
Précise : l'ADR 0023 (« Le rapport de fin de shift reste une déclaration »), l'ADR 0050 § 5 (attribution d'une vente) et § 10 (jusqu'à la bascule), l'ADR 0018 (Reveal fait foi).

## Contexte

Aujourd'hui, le rapport de fin de shift est purement déclaratif. Le chatteur saisit un montant, et un manager actif ou le propriétaire le valide ou le renvoie (EQ-03). Rien ne compare ce montant aux ventes de Reveal.

L'ADR 0043 § 4 prévoit ce contrôle dès que le connecteur lit les ventes. Il n'est pas construit (fiche CR-09), et deux de ses appuis ont changé depuis :

- **plus de saisie vente par vente sur Reveal** (ADR 0050 § 10, CR-03 bloquée) : il n'y a plus de lignes à rapprocher, seulement des totaux ;
- **le registre des ventes existe** (CRM-01, ADR 0050) : il se remplit dès que la clé Reveal est connectée, avant toute bascule, et attribue chaque vente au chatteur relié qui était en poste (§ 5).

Le 06/11, Charles a demandé si les rapports sont vérifiés automatiquement face à Reveal, et quel parcours suivre en cas d'erreur. Il a accepté les recommandations (« ok rapprochement », message du 06/11 à 11 h 54), sans notification Telegram au renvoi : « il a directement tout dans le CRM ». Il a ensuite gardé la validation automatique de l'ADR 0043 dans le nouveau seuil (« ok auto », 12 h 05).

## Décision

**1. La bascule reste le but.** Dès que la clé Reveal est connectée et la vérification propre (ADR 0050 § 8), un compte passe en source « détectée » : plus rien n'est déclaré, donc plus d'écart possible. Cette ADR ne vaut que pour un compte Reveal en source « déclarée » pendant que ses ventes sont lues, et sert de période d'essai à la bascule.

**2. Le rapport est comparé à ce que Reveal a lu pendant le shift.**

- **La référence** est ce que les fans ont payé, TVA comprise (`revenueTtc` du registre, le « brut » de la chaîne de l'ADR 0023, ce que le chatteur déclare).
- **Les ventes prises en compte** sont celles de son compte, attribuées à ce membre selon l'ADR 0050 § 5, de son début de shift à sa fin, marge d'accès comprise (ADR 0025). Leurs remboursements connus au moment de la lecture sont retirés.
- **Le moment** : la comparaison se lit quand le rapport est envoyé, et de nouveau à chaque relecture.
- **Quand elle est complète.** L'horloge ne suffit pas, car le flux des ventes peut prendre du retard sans être coupé (lecture lente, rattrapage après une panne). La comparaison n'est complète que quand deux conditions sont réunies :
  - la fin du shift est passée, marge comprise, plus un quart d'heure pour les lignes en retard ;
  - le registre a été lu jusqu'au bout après ce moment : une lecture du curseur (`sales_feed_cursors`) a atteint la fin du registre de Reveal, sans rien de plus à lire, après la fin du shift plus la marge et le quart d'heure.

  Tant que ce n'est pas le cas, la comparaison est « pas encore complète » (point 7) : le chiffre lu s'affiche comme provisoire, et rien ne se valide seul.
- **Reveal fait foi** (ADR 0018) : on ne corrige jamais Reveal pour le faire coller au rapport.

**3. Le seuil.** Un écart est dans le seuil quand il vaut au plus 1 % des ventes lues, ou au plus 5 €. Les deux valeurs sont des réglages de l'agence (Réglages › Règles de paie) et remplacent les 5 % et 10 € de l'ADR 0043.

**4. Dans le seuil, le rapport se valide seul** (Charles, « ok auto »). C'est le cas seulement s'il n'est pas au-dessus de Reveal, et seulement sur une comparaison complète (point 2).

- **Qui valide.** La validation se fait au nom du « contrôle automatique », au journal d'audit, sous le verrou (membre, quinzaine). Ce chemin est celui que décrit CR-09 : un job sur la connexion admin, avec une marque `automatic`. Il ne passe jamais par un utilisateur inventé.
- **Ce qu'il valide.** Le job valide la version du rapport qu'il a comparée, comme le fait la validation d'un manager. Si le chatteur corrige entre la mise en file et l'exécution, la validation échoue et la comparaison se relit : le job ne valide jamais un montant qu'il n'a pas comparé.
- **Une seule fois.** La clé du job est idempotente par (rapport, version) : deux relectures du registre ne posent jamais deux validations.
- **Personne d'autre.** Aucun membre ne peut poser la marque `automatic` : la politique de la base la refuse à la connexion de l'app (`WITH CHECK`). Et une validation sans auteur est réservée à cette marque, pour qu'aucune validation humaine ne perde son auteur (voir Conséquences).

**5. Au-delà du seuil, ou au-dessus de Reveal, la validation attend le chatteur.**

- **Ce que voit le chatteur.** Juste après l'envoi, son rapport dit « Écart avec Reveal », avec les deux montants. Mon planning dit « Écart · À expliquer ». Il n'y a aucune notification hors du CRM.
- **Ce qu'il peut faire.** Il corrige son montant, ou écrit une explication de 1 000 caractères au plus. Une explication est du texte libre de l'équipe, jamais d'un fan. Elle est validée à la frontière (Zod) et n'est jamais journalisée, comme le corps d'un rapport aujourd'hui.
- **Ce que voit le valideur.** Le montant déclaré, ce que Reveal a lu, l'écart en ambre, et l'explication si elle existe.
- **Le blocage.** La validation est refusée tant que le chatteur n'a ni corrigé ni expliqué : 409 `shift_report_gap_conflict`, avec le temps restant. Ce délai est de 48 h après la fin du shift. Ensuite, ou dès que le chatteur a expliqué, le manager tranche :
  - il valide le déclaré tel quel, en le sachant ;
  - ou il le renvoie ;
  - ou il le valide puis pose une correction de l'agence (EQ-03, `by_agency`), qui suit le circuit habituel de relecture.

**6. Jamais de retenue automatique.** Le code ne baisse, ne retient ni ne corrige jamais un montant, et un écart ne pose aucun malus. Un écart hors seuil compte dans le suivi du manager : le nombre par membre et par quinzaine, sur l'écran des rapports, pour qu'un écart répété se voie.

**7. Sans comparaison possible, rien n'est bloqué.** C'est le cas quand le flux est coupé, la modèle non reliée, le chatteur non relié à son pseudo Reveal, ou la comparaison pas encore complète. Le rapport suit alors la validation humaine d'aujourd'hui, et l'écran dit pourquoi aucun chiffre de Reveal n'est montré. La paie ne lit jamais la comparaison : elle lit le rapport validé, comme aujourd'hui (ADR 0023).

**8. Ce qui reste de l'ADR 0043 § 4.** Les signaux toujours actifs (bonne créatrice, bon shift, total inhabituel) restent. Le rapprochement ligne par ligne tombe, faute de ventes saisies sur Reveal.

## Conséquences

- **Base** (migration attribuée à l'arrivée sur `main`) :
  - le rapport garde l'explication du chatteur ;
  - la validation garde ce qu'elle a vu (montant lu, seuil, verdict), pour qu'un audit relise la décision ;
  - la marque de la validation automatique : un genre de revue `automatic`, refusé à tout membre par la politique (`WITH CHECK`), et un CHECK `(review_kind = 'automatic') = (reviewed_by is null)` ;
  - le seuil, en pourcentage et en euros, borné par des CHECK (de 0 à 100 %, et de 0 à 1 000 €), comme le plafond du minimum de versement ;
  - si le curseur du registre ne dit pas encore quand une lecture a atteint la fin du registre (il garde aujourd'hui `read_at`, la dernière lecture), la migration l'ajoute.
- **Port** : `scheduling` lit les ventes attribuées d'un shift par un port que le composition root branche sur `connectors`. Le registre ne lui est jamais ouvert directement. Pour un écran, le port lit sous les politiques de l'acteur : le chatteur ne voit que son shift, le valideur ceux de l'équipe. La connexion admin ne sert que dans le job. C'est la même frontière que celle de `lastScriptRequest` (#599).
- **Écrans** :
  - le rapport du chatteur ;
  - Mon planning ;
  - Équipe › Rapports (les deux montants, l'écart, l'explication, le compte des écarts) ;
  - Réglages › Règles de paie (le seuil).

  Ces écrans sont relus par Extension.
- **CR-09** se réécrit sur cette ADR.
- **À mesurer pendant l'essai** : la part des rapports dans le seuil, par compte et par quinzaine. Ce chiffre complète la vérification de l'ADR 0050 § 8 avant la bascule.

## Options écartées

- **Notifier le chatteur par Telegram à chaque écart ou renvoi.** Charles, le 06/11 : « il a directement tout dans le CRM ».
- **Retenir ou corriger automatiquement le montant de Reveal.** Le code baisserait une paie sans qu'un humain ait regardé, ce que Charles exclut.
- **Montrer au chatteur le chiffre de Reveal pendant qu'il écrit son rapport.** Il recopierait le chiffre, et l'essai ne mesurerait plus rien. Il le voit juste après l'envoi.
- **Garder les seuils de l'ADR 0043** (5 % et 10 €). Ils sont trop larges pour un contrôle que Charles veut serré.
