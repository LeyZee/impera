# 0022. La persona fait partie de la version qui ouvre l'Automatique

Statut : accepted (Charles, carte de décision du 23/10/2026)
Date : 2026-10-22
Complète : ADR 0019

## Contexte

L'ADR 0019 mesure le taux en réel et le test à l'aveugle « par version de la voix (prompt et modèle) ». Depuis #115, le propriétaire active une autre version de persona depuis l'écran Créatrices. Le verrou ne la voyait pas : un taux de 85 % obtenu avec une persona restait valable après l'activation d'une autre, que personne n'avait encore jugée avec de vrais fans (recette R-G3).

## Décision

- La version prouvée est le prompt de la voix, le modèle **et la version de persona active** de la créatrice (aucune quand elle n'en a pas).
- Chaque brouillon garde la persona active au moment où il est écrit (`drafts.persona_version_id`, déjà prévu, enfin rempli). Chaque test à l'aveugle garde la persona active au moment où il est enregistré (`blind_tests.persona_version_id`, migration 0013).
- Le taux en réel, le nombre de brouillons décidés et le dernier test à l'aveugle ne lisent que cette version. La tendance du Dashboard lit la même sélection.
- Activer une autre persona referme donc l'Automatique comme un changement de voix : au prochain `respond`, sans demander, avec l'événement `automatic_closed`. La nouvelle persona refait ses 100 brouillons et son test à l'aveugle.

## Conséquences

- La règle ne fait que durcir l'ouverture de l'Automatique : elle n'ouvre jamais ce que l'ADR 0019 tiendrait fermé.
- La persona active est lue par la base dans la requête même qui en a besoin, sous RLS : aucune version gardée en mémoire ne peut être périmée.
- Les brouillons et les tests antérieurs gardent `null` : ils ne comptent que tant qu'aucune persona n'est active. Rien n'est supprimé.

## Alternatives rejetées

- **Ignorer la persona** : c'est l'état que la recette a signalé ; une persona jamais jugée enverrait seule.
- **Faire rapporter la persona par le moteur** : plus exact d'une milliseconde, mais il faudrait changer le port du moteur pour une course (activation pendant qu'il écrit) qui ne fait que retarder l'ouverture.
