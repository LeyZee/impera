# ACC-01 Accueils du chatteur et de la modèle, chacun bâti sur ce qu'il fait
Statut : in_progress (PR en brouillon ; captures de recette et OK de Design et d'Équipe à venir)
Phase : espaces (demande de Charles du 21/11, maquette validée « je valide du coup. Go. »)
Dépend de : la persona courte du chatteur (ADR 0153), le registre des ventes (ADR 0124), « Ma journée » (ADR 0140, second avenant)
Branche : claude/project-thread-ma8sa6
Propriétaire proposé : fil « Accueils chatteur et modèle » ; OK de Design (apps/web) et d'Équipe

## Objectif (1 phrase)

Le chatteur ouvre son accueil et sait à qui parler maintenant ; la modèle ouvre le sien et voit d'abord, en gros, ce qu'on attend d'elle aujourd'hui.

## Ce qui est fait

- « À qui parler maintenant » (`GET /v1/conversations/to-talk`) : payeurs qui attendent, nouveaux à accueillir, gros fans silencieux depuis 5 jours ; doute sur l'âge compté, jamais listé ; mêmes droits que la liste des conversations.
- Paliers de dépense par créatrice (`GET`/`PUT /v1/creators/:id/fan-tiers`, propriétaire), 50/200/500 € par défaut ; palier et dépense du fan dans le copilote et l'extension.
- Accueil du chatteur en deux colonnes : à qui parler et ses tâches à gauche, ses chiffres à droite ; « Elle, en trois lignes » dans l'en-tête de poste.
- Accueil de la modèle : « L'essentiel du jour » en haut (un anneau qui additionne ce qu'elle poste, ses tâches du jour et ses envois dus), puis « Ma journée », ses envois, son agenda, trois chiffres de ses fans.
- « Je serai absente » et « Je ne fais plus quelque chose » (module `creator-limits`, migration 0245) : écrits par elle, lus par son équipe en poste, montrés en premier dans « Elle, en trois lignes ».

## Ce qui reste

- La commission du poste en euros sur l'accueil du chatteur (jamais dans l'extension) : il faut la paie (fil Équipe).
- L'agent ne lit pas encore les absences ni « ce qu'elle ne fait plus » : la fiche reste sa source, mise à jour par le propriétaire.
- Remplacer l'anneau de « L'essentiel du jour » par la figure partagée du design system quand elle sera sur `main`.
