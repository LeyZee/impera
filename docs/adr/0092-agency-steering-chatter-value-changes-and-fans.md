# 0092. Piloter l'agence : la valeur de chaque chatteur, ce qui a changé chez une créatrice, les fans qui comptent

Statut : accepted (« ok 0092 » de Charles le 12/11/2026, 23 h 17 ; demande de Charles du 11/11/2026, 18 h 35, et « applique tout » du 12/11/2026, 23 h 11 ; rédigée par le fil « Trouver les trous de pilotage d'agence » ; numéro attribué par le coordinateur)
Date : 2026-11-12
Précise : 0078 (insights du registre), 0081 (statistiques du jour), 0024 (rôles), 0043 § 7 (un chatteur ne voit jamais les chiffres d'un autre). Amende 0078 § « jamais nommé ici » et 0024 (Entraîner).

## Contexte

L'audit fonctionnel du 11/11 (rapport hors dépôt) a joué la journée d'un directeur d'agence dans le bac à sable. Le registre des ventes et la paie sont fiables, mais le Dashboard dit combien, jamais pourquoi :

- « Qui a vendu » donne le chiffre et le panier moyen d'un chatteur, sans heures de shift ni PPV achetés : un chatteur qui travaille deux fois plus paraît deux fois meilleur. CRM-05 (acceptée le 02/11) est « todo ». Reveal donne déjà les PPV envoyés, achetés et les messages par chatteur et par jour (`/v1/stats/chatters/daily`), lus aujourd'hui pour la seule vérification de fiabilité.
- Quand une créatrice baisse, rien ne décompose la baisse, alors que les abonnés, les PPV envoyés (ADR 0081), le registre et le planning existent.
- La vue agence compte les fans sans les nommer : impossible de sortir les gros payeurs qui ont décroché pour les confier à un chatteur.
- Les remboursements ne sont qu'un compteur ; le coût de l'IA n'existe que pour aujourd'hui ; aucun objectif mensuel par créatrice ; les insights concluent sur neuf ventes ; le manager ne peut pas utiliser le playground pour former.

## Décision

1. **La valeur d'un chatteur** (complète CRM-05). Pour chaque chatteur et chaque créatrice, par jour puis sur la période du Dashboard : ventes comptées (registre), heures en poste (shifts finis du planning), **chiffre par heure en poste**, PPV envoyés et achetés et leur **taux d'achat**, messages envoyés (Reveal). Le même calcul pour l'agent sur ses heures « IA seule ». Une valeur que Reveal n'a pas encore calculée s'écrit « pas encore compté », jamais zéro (ADR 0081).
   - Ces chiffres ne changent jamais la paie (test). Le chiffre par heure sert au pilotage seulement (Charles, Q1).
   - Qui les voit : le propriétaire, un manager actif pour les créatrices de sa liste (règles de 0078 § 1). Un chatteur ne voit que les siens, jamais ceux d'un autre ni un classement (0043 § 7).
   - Où : chaque ligne de « Qui a vendu » ouvre la vue du membre ; la fiche du membre en donne le résumé (chiffre, chiffre par heure, taux d'achat, rapports en retard sur la quinzaine).
2. **Ce qui a changé chez une créatrice.** Sur sa vue du Dashboard, un bloc compare la période à la précédente : abonnés gagnés et perdus, **taux de renouvellement** (renouvellements ÷ abonnements arrivés à échéance, quand Reveal donne les deux), payeurs, panier moyen, PPV envoyés et taux d'achat, heures couvertes par chatteur, par l'agent seul et par personne. Pas de phrase d'explication inventée : les écarts sont triés du plus fort au plus faible.
3. **Les fans qui comptent, nommés pour l'agence.** Amende 0078 : sur la vue agence et la vue d'une créatrice, le propriétaire et un manager actif voient le pseudo des payeurs (jamais un contenu de message) dans trois listes : les plus gros payeurs de la période, ceux qui ont payé avant et plus depuis N jours (« ont décroché », N réglable, 21 par défaut), les payeurs communs à plusieurs créatrices de l'agence (même identifiant de fan chez la plateforme). Chaque ligne mène à la conversation dans Suivi quand elle existe. La créatrice ne voit jamais ces listes (ADR 0063). Aucune action automatique.
4. **Les remboursements en liste.** Date, créatrice, type, montant, chatteur de la vente, délai depuis la vente. Lecture seule, filtres par créatrice et par chatteur.
5. **Pas de conclusion sur trop peu.** Une phrase d'insight (créneau qui rapporte, concentration, part de nouveaux payeurs) ne s'écrit que si la période compte au moins 30 ventes et 7 jours de registre ; sinon « Pas encore assez de ventes pour conclure ». Les chiffres restent affichés.
6. **Objectifs mensuels.** Le propriétaire pose un objectif de chiffre d'affaires par créatrice et par mois (le total de l'agence en découle). Le Dashboard montre l'avancement et la projection linéaire à la fin du mois. Interne à l'agence : la créatrice ne le voit pas (Charles, Q4). Sans lien avec Paie › Objectifs, qui reste l'objectif de l'équipe.
7. **Ce que coûte l'IA, créatrice par créatrice.** Complète l'ADR 0091 (consommation et crédits, au global) : sur le même écran Réglages › Consommation IA, une ligne par créatrice et par mois avec le coût de ses appels (`llm_calls.creator_id`), les ventes de l'agent sur la même période (registre) et le rapport des deux. Les appels sans créatrice (veille, tests) restent sur une ligne « Agence ». Lecture seule.
8. **Le playground pour les managers.** Amende 0024 : un manager actif ouvre Entraîner › Playground pour les créatrices de sa liste. Il ne modifie ni la persona ni ses réglages, ne passe pas en Automatique, n'ouvre ni Corrections ni Post du canal (Charles, Q5).

## Conséquences

- Positives : le directeur sait qui est bon, pourquoi une créatrice baisse, quels fans relancer, et ce que coûte l'agent.
- Négatives : un objectif mensuel et un réglage N demandent une table de réglages par créatrice (migration) ; un pseudo de fan s'affiche à plus d'endroits (mêmes droits que Suivi).
- À surveiller : le taux de renouvellement n'est juste que si Reveal donne les échéances ; sinon le bloc l'omet et le dit.
- À surveiller : le mode de l'agent n'a pas d'historique. Ses heures « IA seule » d'une période passée se comptent donc avec son mode et ses créneaux d'aujourd'hui, comme la couverture du Planning (ADR 0048 § 1) : un passage d'Automatique à Copilote en cours de période fausse ce chiffre, et l'écran le dit.
- Les PPV et les messages par chatteur se gardent dans une photo quotidienne par chatteur (migration 0170), lue par le job horaire de l'ADR 0081 avec un appel de plus, compté dans le même quota et sous la même réserve ; comme la photo par compte, elle ne garde ni montant ni fan, et un chatteur ne la lit pas lui-même : ce qu'il voit de ses propres chiffres lui est servi par une route.

## Alternatives rejetées

- Classer les chatteurs entre eux sur un écran qu'ils voient : contraire à 0043 § 7.
- Mettre le chiffre par heure dans les paliers de paie : refusé (Q1).
- Garder les fans anonymes sur la vue agence : on ne peut pas agir sur un fan qu'on ne peut pas nommer.
