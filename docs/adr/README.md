# ADR : décisions d'architecture

Une ADR (Architecture Decision Record) fige une décision structurante avec son contexte, pour qu'une session future ne la rouvre pas sans savoir pourquoi elle a été prise.

## Règles

- Une ADR est **immuable** une fois `accepted`. Pour changer d'avis : nouvelle ADR qui `supersedes` l'ancienne (l'ancienne passe en `superseded`).
- Statuts : `proposed` (une session Opus peut en créer une) → `accepted` (Charles ou la session d'architecture) → `superseded` / `rejected`.
- Numérotation séquentielle à 4 chiffres, nom `NNNN-slug.md`.
- Une session de code qui prend une décision structurante non couverte **doit** créer une ADR `proposed` et le dire dans sa fiche de tâche. Elle ne doit pas passer outre une ADR `accepted`.

## Gabarit

```
# NNNN. Titre
Statut : proposed | accepted | superseded by NNNN | rejected
Date : AAAA-MM-JJ
## Contexte
## Décision
## Conséquences (positives, négatives, à surveiller)
## Alternatives rejetées
```

## Index

| N° | Titre | Statut |
|---|---|---|
| 0001 | TypeScript, monorepo pnpm + Turborepo | accepted |
| 0002 | Monolithe modulaire, frontières vérifiées par ESLint | accepted |
| 0003 | Cœur agnostique de la plateforme (y compris notre future plateforme sans abonnement) | accepted |
| 0004 | Fastify plutôt que NestJS | accepted |
| 0005 | Postgres + Drizzle + RLS par `creator_id` | accepted |
| 0006 | Graphile Worker, une file série par conversation | accepted |
| 0007 | Journal d'événements de conversation comme source de vérité | accepted |
| 0008 | Port `PlatformConnector` ; Reveal via session capturée et client API serveur | accepted (complétée par 0050 : l'API CRM pour les ventes et les chiffres) |
| 0009 | Passerelle LLM unique, trois rôles, règles métier dans le code | accepted |
| 0010 | Persona = donnée versionnée (YAML + schéma Zod), pas du code | accepted |
| 0011 | Argent en unités mineures entières ; identifiants UUID v7 typés | accepted |
| 0012 | `identity_policy` configurable, défaut `stay_in_character` | superseded (0021) |
| 0013 | Code en anglais, documentation, UI et persona en français | accepted |
| 0014 | Politique d'hygiène du dépôt | accepted |
| 0015 | Design system partagé dans `packages/design-system` | accepted |
| 0016 | Clés des fournisseurs IA saisies dans le dashboard, chiffrées en base | accepted |
| 0017 | Vision : Gemini en natif, bascule sur Grok en images clés | accepted |
| 0018 | Port connecteur étendu : scripts natifs, notes, coffre, médias, garde d'écriture | accepted (l'alternative « un second port » remplacée par 0050 pour les ventes et les chiffres) |
| 0019 | Deux taux (au playground, en réel) et la règle qui ouvre le mode Automatique | accepted |
| 0020 | Notifications Telegram : bots, groupes et routage gérés depuis le CRM | proposed |
| 0021 | Rester en personnage est fixé dans le code, sans réglage | accepted |
| 0022 | La persona fait partie de la version qui ouvre l'Automatique | accepted |
| 0023 | La gestion d'équipe entre dans Nirvana : planning, rapports, paie, routine des créatrices | accepted (§ Navigation remplacé par 0024, gardes du chatteur par 0025, congés par 0031, attestation de résidence par 0041, rôle de la créatrice par 0042) |
| 0024 | Rôles et navigation : chacun ne voit que ce qui le concerne | accepted (Suivi du chatteur remplacé par 0025, ligne Créatrice du rail par 0042) |
| 0025 | Le chatteur chatte dans Reveal ; dans Nirvana, il traite sa créatrice pendant son shift, et rien hors shift | accepted |
| 0026 | Serveur MCP de Nirvana : une seconde porte sur les mêmes commandes | accepted (§ 5 « freiner, jamais accélérer » amendé par 0058 pour la seule publication du contenu public) |
| 0027 | Mise en production : deux images, un compose Coolify, un limiteur partagé en Postgres | accepted |
| 0028 | Export quotidien chiffré de la base, hors de Neon | accepted (§ 1 outils et § 2 `--no-privileges` remplacés par 0029) |
| 0029 | L'export garde les droits de la base, et s'outille sans binaire hors d'Alpine | accepted |
| 0030 | Médiathèque : un média, ses liaisons par plateforme, le coffre fait foi | accepted (§ 3 `validated_by` remplacé par 0042 ; § 2 et § 4 remplacés par 0044 pour le contenu déposé et par 0056 pour les scripts déposés) |
| 0031 | Congés et échanges de shift : le congé appartient au membre, l'échange se fait entre chatteurs | accepted (remplace en partie 0023 : congés ; « la seule porte » vers le planning d'un autre remplacée par 0045) |
| 0032 | Paie : la quinzaine se clôture pour toute l'équipe à sa première validation | accepted (complète 0023 § Paie) |
| 0033 | Paie : le taux dollar → euro vient de la BCE, lu chaque heure par un job | accepted (complète 0023 § Paie et 0032) |
| 0034 | Le test à l'aveugle est une séance : le serveur calcule le taux, à partir de 40 situations | accepted (complète 0019 ; exception à 0023 à valider) |
| 0035 | Paie : une saisie verrouille sa quinzaine et chacune des suivantes | accepted (complète 0032 § Verrous) |
| 0036 | Factures : ce qu'une quinzaine doit rendre devient un avoir sur une facture déjà émise | accepted (précise 0023 § Factures) |
| 0037 | Factures : un PDF/A rendu une fois par PDFKit, gardé dix ans sous verrou de conformité, en deux copies | accepted (précise 0023 § Factures et 0028 § 4) |
| 0038 | Paie : un petit montant est reporté deux fois au plus, pour que chaque facture soit payée avant son échéance | accepted (remplace dans 0023 le report sans limite d'un montant positif) |
| 0039 | Factures : une contestation fondée se corrige par la paie, jamais par un avoir écrit à la main | accepted (remplace dans 0036 la phrase sur l'état « créditée » ; précise 0023 § Factures ; au § 3, la ligne refacturée sur la facture du jour et sa conséquence sur le régime remplacées par 0040) |
| 0040 | Factures : « annuler et refacturer » émet une facture rectificative, sous le régime de la facture annulée | accepted (remplace dans 0039 § 3 la ligne refacturée sur la facture du jour) |
| 0041 | Factures : l'attestation de résidence fiscale conditionne le versement, pas la facture | accepted (remplace dans 0023 § Factures la phrase sur l'attestation, et les choix (a) et « ok année civile » du lot 5c) |
| 0042 | Espace de la créatrice : elle voit tout son compte, rien de l'équipe, et personne ne lui impose une tâche | accepted (remplace dans 0023 la phrase de § Rôles sur la créatrice, dans 0024 sa ligne du rail, dans 0030 § 3 la référence de `validated_by` ; au § 6 la phrase sur la source des ventes remplacée par 0054) |
| 0043 | Chatteur : ventes saisies une à une, rapport de fin de shift contrôlé par le code, retours de l'IA sans effet sur la paie | accepted (précise 0023 et EQ-03 ; au § 4 la vente sans attribution et au § 5 le rapport d'un compte détecté remplacés par 0050) |
| 0044 | Feed et Mass DM : la créatrice dépose son contenu dans Nirvana, l'agent le téléverse et le planifie à la semaine | accepted (remplace 0030 § 2 et § 4 pour le seul contenu déposé ; § 1 usage et § 2 départ des 30 jours remplacés par 0055) |
| 0045 | Calendrier des shifts : toute l'équipe et la créatrice voient qui chatte quand, l'agence pose et déplace au doigt | accepted (remplace dans 0031 la phrase « la seule porte ») |
| 0046 | Accès au dashboard : deuxième facteur, connexions bornées, alertes de sécurité | accepted (remplace security.md § 1 sur l'exposition du dashboard ; précisée par 0053 : une clé d'accès vaut mot de passe et code) |
| 0047 | Ranger le code qui a grossi : la paie en quatre modules, l'argent calculé par le seul serveur, l'assemblage par module, le dashboard par domaine | accepted (précise 0002) |
| 0048 | L'IA dans le calendrier des shifts : ses heures se lisent à côté de celles des chatteurs | accepted (précise 0045) |
| 0049 | Créneaux libres, plusieurs chatteurs sur un compte, fans confiés ; la créatrice sans notification de shift | accepted (remplace le réglage de créneaux d'EQ-02, la contrainte d'un membre par compte et 0045 § 4 pour la créatrice) |
| 0050 | Reveal à deux voies : l'API CRM officielle pour les ventes et les chiffres, la session capturée pour tout le reste | accepted (complète 0008 ; remplace dans 0018 l'alternative « un second port » pour les ventes et les chiffres, dans 0043 § 4 la vente sans attribution et § 5 le rapport d'un compte détecté ; précise 0023, dont le calcul des montants par plateforme, 0025, 0049 ; § 8, part de la créatrice, précisé par 0054) |
| 0051 | Un second point d'entrée, pur, pour les règles qu'un module prête aux domaines qui en dépendent | accepted (précise 0002 pour l'ADR 0047 § 1) |
| 0052 | Le chatteur sous l'œil de la persona : chaque message qu'il écrit dans Reveal est relu, chaque écart lui est signalé, rien n'est bloqué ni retenu sur sa paie | accepted (précise 0025 et 0043 § 6 ; au § 5 la phrase sur Telegram remplacée par 0059) |
| 0053 | Clé d'accès (Face ID, empreinte) : un geste vaut mot de passe et code | accepted (précise 0046 § 1, 3, 5 à 8) |
| 0054 | Gains de la créatrice : les chiffres de Reveal dès que son modèle est relié, sans attendre la bascule | accepted (remplace dans 0042 § 6 la phrase sur la source des ventes ; précise 0042 § 6 et 0050 § 8) |
| 0055 | Dépôt de contenu : la créatrice range chaque dépôt dans sa catégorie, l'agence lui demande ce qui manque | accepted (remplace dans 0044 § 1 l'usage à deux valeurs, et § 2 le départ des 30 jours) |
| 0056 | Scripts : l'agence écrit ses structures, la créatrice tourne carton par carton, Nirvana range dans l'ordre et téléverse | accepted (remplace 0030 § 2 et § 4 pour les scripts déposés) |
| 0057 | Instagram et Telegram : deux connecteurs de publication, par les API officielles, dans le même plan que le feed | accepted |
| 0058 | Un agent externe peut préparer et publier le contenu public de la créatrice, et seulement lui | accepted (amende 0026 § 5 pour la seule publication) |
| 0059 | Écarts de persona sur Telegram : les interdits graves tout de suite, les autres au bilan du soir, jamais un nom | accepted (remplace dans 0052 § 5 la phrase sur Telegram ; précise 0020) |
