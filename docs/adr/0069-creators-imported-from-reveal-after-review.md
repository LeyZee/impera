# 0069. Les créatrices s'importent depuis Reveal par une revue du propriétaire, jamais en silence

Statut : accepted (Charles, 03/11/2026, 19 h 58, « ok 0069 » ; demande de Charles du 03/11/2026, 19 h 34 : « dès qu'on branche la clé Reveal […] ça intègre directement tous les modèles qu'on a […] avec toutes leurs données » ; « go import », 19 h 45, sur la proposition d'une revue avant création)
Date : 2026-11-03
Précise : l'ADR 0050 § 3 (lien d'un modèle à un compte) et l'ADR 0054. Ne remplace rien.

## Contexte

Quand la clé de l'API CRM est posée, le CRM lit déjà `/v1/models` (`listModels`). Chaque modèle Reveal doit être relié à un compte de plateforme d'une créatrice : le lien se pose seul quand le pseudo correspond à un compte existant (`linkedBy: auto`), sinon le propriétaire le choisit dans Réglages › Ventes Reveal. Les ventes d'un modèle sans lien attendent de côté et passent au moment du lien.

Ce qui manque : une créatrice qui n'existe pas encore dans le CRM doit être créée à la main, puis son compte Reveal, avant de pouvoir être reliée. Avec plusieurs créatrices, c'est long et source de doublons.

Ce que `/v1/models` donne : identifiant, pseudo, nom affiché, photo (adresse publique ou rien), `isActive`, statut (`validated`, `pending`, `onboardingChangesRequested`, `refused`, `banned`, d'autres peuvent s'ajouter), nombre d'abonnés, prix et formules d'abonnement, date de création. Le reste de l'API donne ses ventes (31 jours avant l'ouverture du registre), ses chiffres par jour et les chatteurs qui la couvrent. Rien sur ses conversations, notes, scripts ou coffre, ni son vrai nom, son contact, son contrat ou son fuseau horaire.

## Décision

1. **Une revue, jamais une création silencieuse.** À la pose de la clé, puis à chaque lecture de `/v1/models` qui trouve un modèle sans lien, le CRM propose ; seul le propriétaire crée. Réglages › Ventes Reveal montre « N créatrices trouvées sur Reveal », une ligne par modèle sans lien, avec une action proposée :
   - **Relier à** une créatrice existante, quand son nom correspond (`creatorNameKey`, sans casse ni accents) ou qu'un de ses comptes a ce pseudo ;
   - **Créer** sinon.
   Le propriétaire peut changer l'action, ou écarter la ligne. Une ligne écartée ne revient pas ; elle reste dans la liste repliée « Écartées », d'où on peut la reprendre.
2. **Cochées d'avance** : seulement les modèles `validated` et actives. `pending`, `onboardingChangesRequested`, `refused`, `banned`, inactive ou statut inconnu : décochées, avec le statut affiché. Un clic « Importer la sélection » fait tout le lot.
3. **Ce que la création remplit** : la créatrice (nom affiché de Reveal, ou pseudo s'il est vide ; fuseau `Europe/Paris`, à changer sur sa fiche), son compte Reveal (pseudo), le lien du modèle (`linkedBy: member`, le propriétaire), et sa photo, copiée dans notre stockage pour ne pas dépendre de l'adresse Reveal. Les ventes en attente passent alors comme pour un lien posé à la main. L'opération est idempotente sur l'identifiant du modèle : un double clic ou une relance ne crée pas deux créatrices, et un nom déjà pris est refusé ligne par ligne, sans faire tomber le lot.
4. **Ce qu'elle ne remplit jamais** :
   - la persona : aucune fiche, aucun brouillon, rien de Reveal n'y entre ;
   - le pourcentage de l'agence et toute règle d'argent : saisis à l'écran par le propriétaire ;
   - l'agent : il reste éteint pour elle ;
   - son espace : aucune invitation ne part. On ne l'ouvre qu'avec son accord, par le parcours existant.
   Après l'import, sa fiche liste ce qui reste à faire : pourcentage, fuseau, persona, invitation.
5. **Plus tard** : un modèle sans lien qui apparaît chez Reveal fait un badge « 1 nouvelle créatrice sur Reveal » dans Réglages, pour le propriétaire seul. Un modèle qui disparaît de `/v1/models` ou passe `banned` ne supprime rien : sa fiche reste, et une alerte le signale.
6. **Droits et RLS** : propriétaire seulement, mot de passe redemandé comme pour les autres réglages du flux. Chaque créatrice créée est un nouveau tenant : ses lignes s'écrivent dans `withTenant` de cette créatrice, aucune nouvelle table hors RLS. Chaque création et chaque ligne écartée vont au journal d'audit (identifiant du modèle, jamais d'abonnés ni de montants).
7. **Données réelles** : rien de ce que renvoie Reveal n'entre dans le dépôt, les fixtures ou les logs. `FakeReveal` gagne des modèles inventées couvrant chaque statut, un pseudo déjà pris et un nom en double.
8. **Propriété** : Bilan pour l'API, le contrat et `connectors` (champs `status` et `avatarUrl` ajoutés à `PlatformModel`, route d'import) ; Extension pour l'écran, avec captures Nuit et Jour avant fusion. Une migration seulement si l'état « écartée » ne tient pas dans `sales_feed_models` ; elle prendrait alors le prochain numéro libre.

## Conséquences

- Avec la clé posée, une agence se monte en un écran : les créatrices, leurs comptes Reveal et leurs ventes des 31 derniers jours, sans saisie.
- Une créatrice importée n'est pas prête à chatter : la persona, le pourcentage et la capture de session restent à faire, et la fiche le dit.
- L'historique au-delà de 31 jours reste l'export du dashboard (ADR 0050).
- Le rapprochement par nom peut se tromper (deux créatrices au nom proche) : c'est pour cela que l'action n'est qu'une proposition.

## Alternatives écartées

- **Création automatique à la pose de la clé** : crée des modèles refusées ou bannies, des doublons avec les fiches déjà saisies, et un tenant sans que personne l'ait décidé.
- **Garder la création à la main** : c'est l'état actuel, long dès qu'il y a plusieurs créatrices.
- **Remplir la persona depuis la bio Reveal** : la persona est validée à la main (règle de l'agence), et l'API ne donne pas la bio.
