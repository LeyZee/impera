# CRM-08 Revue de l'équipe Reveal : l'écran (ADR 0076)

Statut : in_progress (ADR 0076 acceptée par Charles le 06/11/2026, 18 h 07 ; routes de Bilan #626 et #643, invitation et alerte d'Équipe EQ-20)
Phase : API CRM (ADR 0050, ADR 0076)
Dépend de : `GET/POST /v1/settings/sales-feeds/:platform/team…` (Bilan), l'invitation depuis une proposition (Équipe, EQ-20)
Branche : claude/extension-reveal-playground-45axcj
Propriétaire : Extension (ADR 0076 § 10)

## Objectif
Le propriétaire et un manager actif relient chaque compte de l'équipe Reveal à un membre, à l'agent ou à personne, en lot, et invitent ligne par ligne un membre de l'agence que rien ne rapproche. Rien n'est relié ni créé sans un clic.

## Contexte à lire
ADR 0076 (§ 1 à § 7), ADR 0050 § 5, ADR 0024 § Rôles, `packages/contracts/src/sales-feed-team.ts`.

## À faire
- [x] Onglet Équipe › Reveal (`/equipe/reveal`), au propriétaire et aux managers actifs (Réglages › Ventes est au seul propriétaire) ; compteur des nouveaux venus et des retraits sur l'onglet (§ 5, § 6).
- [x] « À confirmer » : la proposition de chaque ligne et sa raison (même e-mail, mêmes prénom et nom, session capturée, nommé « bot »), cochée quand le serveur la présélectionne ; la liste n'offre que ce que `actions` permet ; « Confirmer la sélection (N) » en un lot, le refus d'une ligne dit sous elle.
- [x] « Inviter » ligne par ligne : le panneau d'ajout d'un membre, prérempli depuis Reveal (prénom, nom, e-mail non modifiable), le mot de passe redemandé ; pour un manager, un chatteur, un préréglage du propriétaire et ses créatrices seulement, celles des modèles Reveal cochées.
- [x] « Reliés » : le lien se change sur place ; la ligne d'un manager sur lui-même reste sans geste (§ 4) ; retrait en ambre (§ 5), modèles et écart de créatrices (§ 7).
- [x] Repli « Bots et comptes écartés » : un compte écarté se reprend ; les bots des clés d'API y sont, cochés sur « Personne ».
- [x] Lecture anormale et liste absente dites en ambre ; les liens restent.
- [x] Réglages › Ventes : la liste des liens de l'équipe laisse la place à un renvoi vers Équipe › Reveal, avec ses compteurs.
- [ ] Captures Nuit et Jour, ordinateur et téléphone, vues par Charles avant fusion.

## Critères d'acceptation
- Tests : règles de l'écran (`reveal.test.ts`) ; écran (`RevealPage.test.tsx` : lot sans invitation et refus d'une ligne, retrait et ligne du manager sans geste, options bornées par `actions`, écarter et reprendre, invitation d'un manager bornée avec mot de passe redemandé, phrase du serveur, lecture anormale, accès refusé) ; Réglages › Ventes renvoie vers Équipe › Reveal.
- Écrans vus par Charles (Nuit et Jour, ordinateur et téléphone) avant fusion.
