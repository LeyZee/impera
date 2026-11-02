# Fiches de tâches

Une fiche = une session Opus 5.5 = une branche `task/<id>-<slug>` = une PR. Une session ne touche pas à ce qui n'est pas dans sa fiche ; si elle découvre un besoin, elle crée une nouvelle fiche `proposed` (`PROPOSED-<slug>.md`) et le note dans son entrée de journal.

## Format

```
# <ID> <Titre>
Statut : proposed | todo | in_progress | blocked | done
Phase : n
Dépend de : <IDs>
Branche : task/<id>-<slug>

## Objectif (1 phrase)
## Contexte à lire (fichiers précis)
## À faire (liste vérifiable)
## Critères d'acceptation (tests, commandes, comportements observables)
## Hors périmètre
## Notes de session (rempli par la session : décisions, surprises, fiches créées)
```

## Statuts

- `proposed` : écrite par une session, pas encore acceptée par Charles ; pas d'ID, pas dans l'index.
- `todo` : prête à être prise.
- `in_progress` : une session y travaille (une seule à la fois ; le nom de la branche est dans la fiche).
- `blocked` : attend Charles ou une autre fiche ; la raison est dans la fiche.
- `done` : PR fusionnée, critères vérifiés, LOG mis à jour.

## Index

| ID | Titre | Phase | Statut | Dépend de |
|---|---|---|---|---|
| P0-01 | Outillage du monorepo | 0 | done | — |
| P0-02 | Contrats partagés : identifiants, argent, événements, jobs | 0 | done | P0-01 |
| P0-03 | Base de données : schéma noyau, migrations, RLS, `withTenant` | 0 | done | P0-02 |
| P0-04 | Serveur Fastify et worker Graphile, composition root, santé | 0 | done | P0-03 |
| P0-05 | Module `conversations` : ingestion, journal, projections | 0 | todo | P0-04 |
| P0-06 | Module `connectors` : port, `FakeConnector`, test de contrat, poller | 0 | todo | P0-05 |
| P0-07a | Authentification du dashboard, rôles, CSRF, page de connexion | 0 | done | P0-04 |
| P0-07b | CI, scripts ops, bout en bout phase 0 | 0 | todo | P0-06, P0-07a |
| P0-08 | Schéma de persona calqué sur OnlyChat | 0 | done | P0-01 |
| P1-01 | Extension : enregistreur d'API | 1 | todo | P0-01 |
| P1-02 | Analyse de l'API Reveal et FakeReveal | 1 | blocked (capture de Charles) | P1-01 ou capture HAR |
| P1-03 | Décision B/C et spécification du connecteur Reveal | 1 | todo | P1-02 |
| P3-01 | Passerelle LLM multi-fournisseurs, Grok 4.7 et playground en terminal | 3 | in_progress | P0-01 |
| P3-02 | Mémoire par fan : coder le module `fans` | 3 | todo | P0-03, P0-05, P0-08, P1-02 |
| P3-03 | Connecter Grok, Gemini et ElevenLabs depuis le dashboard | 3 | todo | P0-03, P0-04, P0-07a, P3-01, D-01 |
| P6-01 | Catalogue tarifé : index des scripts Reveal, de leurs étapes et de leurs bundles | 6 | todo | P3-02, P1-02, P1-03 |
| P6-02 | Après une offre : refus, achat, aide au paiement, relances de vente | 6 | todo | P6-01, P3-10 |
| P3-04 | Vision des médias et protection contre les pièges | 3 | in_progress | P3-01 |
| P3-05 | Boucle de calibrage dans le playground | 3 | in_progress | P3-04 |
| P3-07 | Notifications Telegram : bots, groupes, routage, page Réglages › Telegram | 3 | in_progress | P0-05, P0-07b, P3-03 |
| P3-08 | Recette du copilote dans Suivi, de bout en bout, avec FakeReveal | 3 | todo | PROPOSED-reveal-connector, PROPOSED-copilot-api, clé xAI |
| P3-09 | Curseur de sexualisation, minimum de KYC et âge confirmé | 3 | done | P3-02 |
| P3-10 | Relances : un fan n'est jamais laissé sans réponse | 3 | done | P0-05, P3-02 |
| P3-11 | Réponse différée après « attends, je reviens » | 3 | done | P3-10 |
| P3-12 | Note de désir : la tension sexuelle de chaque fan, et ne vendre que quand elle est haute | 3 | todo | P3-09, P3-02 |
| P3-13 | Gardes de voix : didascalies, média annoncé, mots de rencontre, fausse urgence, répétitions | 3 | todo | — |
| P3-14 | Heures d'activité de l'agent, par créatrice | 3 | todo | P3-10, P3-11, EQ-02 |
| P4-01 | Alertes personnalisées, demandes de service et historique des alertes | 4 | todo | P3-07 |
| P5-01 | Persona par blocs, compteur de complétion et infos à collecter | 5 | todo | P0-08, P3-02 |
| H-01 | Première session d'hygiène | 0 | todo | P0-07b |
| D-01 | Design system « Liquid Glass » | 4 | in_progress | P0-01 |
| D-02 | Recette design et navigation de l'interface web | 4 | in_progress | D-01 |
| EQ-01 | Équipe : membres, pays, commission, paramètres de paie des plateformes | équipe | in_progress | ADR 0023, ADR 0024 ; écrans : EQ-11 |
| EQ-02 | Planning des shifts et « qui est en poste » | équipe | in_progress | EQ-01 |
| EQ-03 | Rapport de fin de shift dans Nirvana | équipe | in_progress | EQ-02 |
| EQ-04 | Moteur de paie : calcul pur, périodes, verrou | équipe | in_progress | EQ-01, EQ-03 |
| EQ-05 | Paie : écrans de validation, de paiement et commissions du chatteur | équipe | done | EQ-04, EQ-11 |
| EQ-06 | Factures des prestataires : autofacturation, avoirs, export comptable | équipe | done | EQ-04, EQ-05 |
| EQ-07 | Import de l'historique d'Imperium (optionnel) | équipe | blocked (pas de base d'Imperium) | EQ-01 à EQ-06 |
| EQ-08 | Mode hybride : passage à l'humain pour vendre, routage et attribution | 3-4 | blocked (capture Reveal, clés) | EQ-02, P6-01 |
| EQ-09 | PWA de la créatrice : routine, revenus, qui est en poste | 5 | done (remplacée par CR-01 à CR-07, ADR 0042) | EQ-01, EQ-02, EQ-04 |
| EQ-10 | Connexion et premier accès du chatteur | équipe | todo | EQ-01, EQ-11 |
| EQ-11 | Shell par rôle : rail, barre du téléphone et gardes de route | équipe | todo | ADR 0024, EQ-01 (`/v1/me`) |
| EQ-12 | Annonces, prise de poste et notifications de l'équipe, sans Telegram | équipe | todo | CR-01, EQ-02, CR-13, EQ-10, EQ-11 |
| EQ-13 | Accès d'un chatteur borné à son shift | équipe | todo | ADR 0025, EQ-01, EQ-02, filtre des conversations routées |
| EQ-14 | Gestes de la fiche d'un membre et départ | équipe | in_progress | EQ-01 (gestes) ; EQ-02, EQ-04 à EQ-06 (départ) |
| EQ-15 | Double authentification pour le propriétaire et les managers | équipe | todo | EQ-01, EQ-10, EQ-11 |
| EQ-16 | S'entraîner : les recrues s'exercent contre des fans simulés | équipe | blocked (clés, comme le playground) | EQ-10, EQ-11, P3-01, P3-05 |
| EQ-17 | Mise en service de la paie : sauvegardes, comptable, paie à blanc | équipe | in_progress | EQ-04 à EQ-06, EQ-15, déploiement |
| EQ-18 | Journal : qui a fait quoi, lisible par le propriétaire | équipe | todo | EQ-11 |
| EQ-19 | « Voir comme » : l'écran exact d'un chatteur, en lecture seule | équipe | todo | EQ-10, EQ-11, EQ-15, EQ-18 |
| CR-01 | Socle de l'application installable : manifeste, service worker, notifications, clés d'accès | espaces | todo | ADR 0042, EQ-11 |
| CR-02 | Accès de la créatrice : invitation, son compte en lecture, rien de l'équipe | espaces | todo | CR-01, ADR 0042, EQ-11 |
| CR-03 | Ventes saisies par le chatteur et rapport de fin de shift qui les reprend | espaces | blocked (pas construite pour Reveal avant une autre plateforme : ADR 0050 § 10, recommandation acceptée par Charles le 02/11/2026) | EQ-03, EQ-04, CR-01 (téléphone) |
| CR-04 | Gains et ventes de la créatrice, au jour le jour | espaces | todo | CR-02, CR-03 ou CRM-04, EQ-01 (paramètres de plateforme) |
| CR-05 | Agenda de la créatrice : créneaux, tâches, routine, suggestions et disponibilités | espaces | todo | CR-01, CR-02, CR-12 (couche des shifts) |
| CR-06 | Dépôt de contenu : feed et Mass DM, depuis le téléphone | espaces | todo | CR-02, ADR 0030 (médiathèque), le stockage objet de production (ADR 0027, 0037) |
| CR-07 | Topo de la semaine : faits calculés, suggestions rédigées, relues par l'agence | espaces | blocked (clé xAI) | CR-04, CR-05, CR-06, la passerelle LLM (P3-01) et la clé du fournisseur |
| CR-08 | Plan de publication du feed : la semaine préparée, acceptée d'un geste, programmée dans Reveal | espaces | blocked (capture Reveal) | CR-06, CR-07, la capture Reveal, le connecteur Reveal (lot A), la garde d'écriture (ADR 0018) |
| CR-09 | Contrôle du rapport de fin de shift et validation automatique par les ventes de Reveal | espaces | todo (total inhabituel) ; blocked (signaux par vente, rapprochement) | EQ-03 ; CR-03 pour les signaux par vente ; CRM-01 et CRM-03 pour le rapprochement |
| CR-10 | Retours de l'IA aux chatteurs, chaque semaine, sans effet sur la paie | espaces | blocked (lecture des messages de Reveal avec leur auteur, clé du fournisseur) | le connecteur Reveal (messages et auteur), la passerelle LLM, la rubrique des évaluations |
| CR-11 | Mass DM : les médias déposés, envoyés aux listes de fans, jamais deux fois | espaces | blocked (capture Reveal) | CR-06, CR-08, la capture Reveal |
| CR-12 | Calendrier des shifts pour toute l'équipe et la créatrice : lecture, vue Mois, lien de calendrier | espaces | todo | EQ-02, CR-02 |
| CR-13 | Poser et déplacer les shifts au doigt : glisser-déposer, ajout en masse, semaine en modèle, suggestion | espaces | todo | CR-12 |
| CRM-01 | Connecter la clé Reveal et lire les ventes | API CRM | todo | ADR 0050 fusionnée ; une clé créée par Charles pour la recette réelle seulement |
| CRM-02 | Prouver la fiabilité sur une quinzaine passée | API CRM | todo | CRM-01, l'export du dashboard fourni par Charles hors dépôt |
| CRM-03 | Paie sur les ventes lues, téléphone du chatteur et mini feedback | API CRM | todo | CRM-01, l'accord de Charles après CRM-02, CR-01 (téléphone) |
| CRM-04 | Ventes en direct : alertes Telegram, bilan et revenus de la créatrice | API CRM | todo | CRM-01 |
| CRM-05 | Ventes hors shift, écarts d'assignation et performance des chatteurs | API CRM | todo | CRM-01, CRM-03 pour les ventes en attente |
| CRM-06 | CA de l'agent et achats dans la mémoire du fan | API CRM | todo | CRM-01, CRM-02 pour le CA de l'agent ; la capture Reveal pour la mémoire |
| OPS-01 | Mise en production : images, limiteur partagé, runbook | exploitation | done | ADR 0027 |
| OPS-02 | Export quotidien chiffré de la base, hors de Neon | exploitation | in_progress | OPS-01, ADR 0028 |
| SEC-01 | Audit de sécurité : premiers correctifs | exploitation | done | — |
| SEC-02 | Deuxième facteur pour tous les comptes | exploitation | todo | ADR 0046, SEC-01 |
| SEC-03 | Limites de connexion par compte et adresse, sessions de 7 jours au plus | exploitation | todo | ADR 0046, SEC-02 |
| SEC-04 | Réglages › Sécurité et alertes de sécurité | exploitation | in_progress | ADR 0046, ADR 0020, SEC-02 |
| ARC-01 | Les sommes et la prévision de quinzaine rendues par le serveur | exploitation | done | ADR 0047 |
| ARC-02 | L'assemblage module par module | exploitation | in_progress | ADR 0047 |
