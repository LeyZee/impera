# 0024. Rôles et navigation : chacun ne voit que ce qui le concerne

Statut : accepted (Charles, 27/10/2026) ; le Suivi du chatteur est remplacé par l'ADR 0025
Date : 2026-10-27
Remplace : le § Navigation de l'ADR 0023 ; précise ses § Rôles et § Données et RLS (scope `owner`, statut `active`)

## Contexte

Avec l'équipe, la paie et les factures (ADR 0023), Nirvana gagne quatre publics (propriétaire, manager, chatteur, créatrice) et une dizaine d'écrans. Le rail actuel (Dashboard, Créatrices, Entraîner, Suivi, Réglages) est statique et le même pour tous. L'ADR 0023 rangeait la paie dans Équipe et donnait au chatteur « Mon planning, Mes rapports, Mes commissions ».

Le 27/10, Charles a demandé de réorganiser Nirvana « parce que ça va devenir très gros comme app », et il a validé la carte ci-dessous le même jour. La relecture de la fiche EQ-01 par le propriétaire de `packages/db` a montré qu'avec deux scopes (`self`, `agency`), la base ne distingue pas le manager du propriétaire : « seul le propriétaire change un taux » ne tiendrait qu'à l'écran.

## Décision

### Le rail dépend du rôle

| Rôle | Onglets, dans l'ordre | Téléphone |
|---|---|---|
| Propriétaire | Dashboard · Chatting : Suivi, Entraîner · Agence : Équipe, Paie, Créatrices · Réglages | Dashboard, Suivi, Équipe, Paie, Plus |
| Manager | Dashboard · Suivi · Équipe · Paie · Moi | les mêmes cinq |
| Chatteur | Aujourd'hui · Suivi · Planning · Commissions · Moi | les mêmes cinq |
| Créatrice | sa PWA (EQ-09) : Aujourd'hui · Revenus · Factures · Qui chatte · Moi | les mêmes cinq |

- Deux familles, séparées par un intertitre discret dans le rail : **Chatting** (l'agent, les conversations) et **Agence** (l'équipe, l'argent, les créatrices).
- Au plus six onglets plus Réglages sur ordinateur ; cinq emplacements sur téléphone, dont **Plus** (une feuille de verre, elle flotte) quand il en faut davantage.
- Un onglet n'apparaît que lorsque son écran existe : pas d'onglet vide ni grisé.

### Ce que contient chaque onglet

- **Dashboard du propriétaire**, « zéro bruit » : le mode de l'agent, puis seulement ce qui demande une action aujourd'hui (À traiter, rapports à valider, paie à valider, factures contestées) et un seul chiffre, les ventes de la quinzaine. Les indicateurs détaillés vivent dans leur onglet.
- **Dashboard du manager** : l'équipe d'abord (qui est en poste, rapports à valider, paie à valider).
- **Suivi** garde ce nom pour tous. Propriétaire et manager : la file À traiter. Chatteur : en hybride, la file des passations `sale` qui lui sont routées (EQ-08), jamais toutes les conversations de ses créatrices.
- **Équipe** : Planning, Rapports, Membres, Annonces.
- **Paie** est un onglet à part entière, pas un sous-onglet d'Équipe : période en cours, relevés de commissions, primes et malus, objectifs, factures, export comptable. Le manager mène une paie jusqu'à « validée » ; seul le propriétaire la marque « payée ».
- **Créatrices** : fiches, persona, comptes ; plus tard leur routine et leur facturation.
- **Réglages** gagne Plateformes et paie (TVA, commissions, créneaux, préréglages), Facturation (agence, régimes par pays, mandat) et Journal.
- **Aujourd'hui** (chatteur) : son shift, « Faire mon rapport », son objectif, les annonces.
- **Planning** (chatteur) : le sien, celui de l'équipe, ses congés et ses échanges.
- **Commissions** (chatteur) : ses relevés, ses factures à accepter ou contester, sa progression vers le palier suivant.
- **Moi** est l'espace personnel de chacun, sous un seul nom : pour le manager, son planning, ses commissions et son dossier ; pour le chatteur, son dossier prestataire, son contrat et son mandat ; pour la créatrice, son profil.

### Rôles et scopes

- Toujours aucun nouveau rôle d'accès (ADR 0023) : le propriétaire est `owner`, le manager et le chatteur sont des `operator` distingués par leur rôle d'équipe, la créatrice est `creator`.
- `/v1/me` expose le rôle d'équipe. Le rail et les gardes de route (`beforeLoad`) le lisent ; les refus du serveur restent la vraie barrière.
- `withMember` fixe `app.team_scope` à l'une de trois valeurs, calculée par le serveur dans la transaction, jamais lue dans la requête :
  - `owner` pour le propriétaire : il lit tout ce que lit `agency`, et lui seul insère un taux ou un préréglage de commission ;
  - `agency` pour un manager au statut `active`, **et seulement ce statut** ;
  - `self` pour tous les autres, dont un manager en congé, malade, en voyage ou suspendu (Charles, 27/10). Un manager qui travaille pendant un voyage reste `active` : le statut dit s'il travaille, pas où il est.

### Ordre de mise en œuvre

Cette ADR → le rôle d'équipe dans `/v1/me` (EQ-01, par le propriétaire de `packages/contracts`) → le shell par rôle seul (EQ-11, par le propriétaire d'`apps/web`) → les écrans (EQ-01 à EQ-06, EQ-10).

## Conséquences

- Un chatteur ne voit jamais Entraîner, la persona, les Réglages ni la paie d'un autre, et la base dit la même chose que l'écran.
- Le rail devient une configuration par rôle : ajouter un onglet, c'est une ligne de configuration et une garde.
- Quatre icônes nouvelles, chacune avec son geste, entrent dans le design system : Équipe, Paie, Moi, Plus.
- À surveiller : l'en-tête de la Paie entre 821 et 1 100 px de large, avec six sous-onglets ; le repli est le défilement horizontal de la `SubNav`, qui existe déjà sur téléphone.

## Alternatives rejetées

- **La paie sous Équipe** (ADR 0023) : l'argent à deux gestes, mêlé au planning.
- **Un même rail pour tous, avec des onglets grisés** : du bruit, et l'impression qu'on cache quelque chose.
- **Un nom d'espace personnel par rôle** (« Profil », « Mon espace ») : un seul nom, « Moi ».
- **Un rôle d'accès `manager`** : toujours rejeté, pour les raisons de l'ADR 0023.
- **Laisser la main à un manager absent** : il validerait une paie sans voir les rapports du jour, et son compte resterait ouvert à l'agence pendant qu'il n'y travaille pas.
