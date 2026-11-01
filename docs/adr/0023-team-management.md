# 0023. La gestion d'équipe entre dans Nirvana : planning, rapports, paie, routine des créatrices

Statut : accepted (Charles, 27/10/2026, avec ses précisions du même jour : règles d'Imperium inchangées, commission seule, historique repris) ; § Navigation remplacé et § Rôles, § Données et RLS précisés par l'ADR 0024 ; § Mode hybride, point « Gardes sur les messages du chatteur », remplacé par l'ADR 0025 (le chatteur chatte dans Reveal) ; § Données et RLS, « congés », remplacé par l'ADR 0031 (le congé appartient au membre) ; § Les règles d'Imperium, telles quelles, « le report des petits montants » remplacé par l'ADR 0038 pour un montant positif (deux reports au plus)
Date : 2026-10-27
Remplace : la ligne « pont Imperium (export) » de la phase 6 (`docs/roadmap.md`) et l'idée d'un Imperium client de l'API Nirvana (`brainstorm/02-architecture-et-stack.md` §1.3)

## Contexte

Imperium (`LeyZee/imperium`, Express + SQLite) gérait l'équipe de chatteurs de l'agence : planning des shifts, ventes déclarées, paie et factures automatiques, routine quotidienne des créatrices dans une PWA. Il est à l'arrêt. Charles recrute de nouveaux chatteurs et veut retrouver ces fonctions dans Nirvana, avec le design system de Nirvana, un code propre et une paie « vraiment fiable et robuste » (27/10/2026). Les chatteurs font désormais leur rapport de fin de shift dans l'application : l'équipe ne dépend plus de Telegram.

Les chatteurs ne sont pas des salariés : ce sont des **prestataires indépendants**, établis pour la plupart hors de l'Union européenne, rémunérés uniquement à la commission. L'agence établit leurs factures en leur nom (autofacturation).

Charles veut aussi un mode **hybride** : l'agent tient la relation avec les fans, des chatteurs vendent (l'agent peut vendre aussi). Le moteur sait déjà passer la main à un humain (`handoff`), un humain sait la prendre (`takeover`) et la rendre avec une note (`release`, `operator_note`).

La règle de `docs/reference/legacy-projects.md` tient : on reprend les concepts d'Imperium, jamais son code.

## Décision

### Les règles d'Imperium, telles quelles

Charles (27/10) : les systèmes d'Imperium « sont très bons », on ne les change pas, on les reconstruit proprement. Sont donc repris **à l'identique** : la chaîne de calcul (brut → euros → hors TVA → net de la commission de la plateforme → part du chatteur), le taux de commission propre à chaque chatteur, les paliers individuels (le plus haut atteint compte), l'objectif collectif et ses paliers (managers exclus), les primes manuelles avec motif, les malus fixes ou en pourcentage plafonnés à la part plus les primes, la part du net de l'équipe pour un manager, le report des petits montants sous le minimum de versement, la vente arrivée après validation portée sur la période suivante, les quinzaines, le verrou « payé ».

Ce qui change n'est que la construction (entiers, verrous, immuabilité, tests, RLS : § Paie) et ce que la loi impose aux factures (§ Factures). Toute autre différence de résultat avec Imperium est un bogue.

### Modules

- `team` : le profil d'un membre de l'équipe, lié à son compte (`user`) : rôle d'équipe (`chatter` ou `manager`), pays, fuseau, taux de commission, statut, et son dossier prestataire (identité légale et fiscale pour ses factures). Les paramètres d'une plateforme utiles à la paie (TVA, commission de la plateforme, devise) et la part de l'agence sur une créatrice s'ajoutent aux tables existantes.
- `scheduling` : shifts par créatrice, créneaux, modèles récurrents, congés, échanges, et la question « qui est en poste sur cette créatrice maintenant ? ». Les rapports de fin de shift y vivent.
- `payroll` : périodes, calcul, primes, malus, report, verrou, relevés de commissions, factures et avoirs.
- `creator-tasks` : routine de l'agence et tâches personnelles des créatrices, complétions, série. Servi par la PWA de la phase 5.
- `sales` (P6-01) devient le registre des ventes détectées, et chaque vente porte son **auteur** : l'agent, ou le membre de l'équipe qui tenait la conversation.

Chaque module suit `docs/architecture/modules.md`. Aucune de ces fonctions ne passe par Telegram ; le module `telegram` garde les alertes (ADR 0020) et n'est pas une dépendance de l'équipe.

### Rôles

Pas de nouveau rôle d'accès. Le chatteur et le manager sont des `operator` (`creator_ids` borne leurs créatrices) ; le rôle d'équipe (`team_members.team_role`) dit ce qu'un manager voit en plus : toute l'équipe, la validation des rapports et des paies jusqu'à « validée ». Seul l'`owner` marque une paie « payée ». La `creator` voit sa routine, ses revenus, ses factures et qui est en poste, jamais une conversation ni un fan.

### Une seule source de revenus par compte

Pour chaque compte plateforme, la paie lit **une** source par période : les montants **déclarés** dans les rapports de fin de shift validés, ou les ventes **détectées** par le connecteur. Le choix est un réglage du compte, il ne change qu'à une frontière de période. Une même vente ne peut donc jamais compter deux fois. Tant que le connecteur Reveal n'écrit pas les ventes, tous les comptes sont en « déclaré ».

### Paie

- Le calcul est une fonction pure du domaine de `payroll` : mêmes entrées, même relevé, sans horloge ni accès à la base.
- **Entiers seulement**, en base comme dans le domaine : montants en unités mineures (ADR 0011), taux en points de base, taux de change en entier mis à l'échelle (`rate_micros bigint`, un millionième). Jamais de `float`.
- Ordre de calcul d'Imperium, sur le **total du compte pour la période** (jamais vente par vente) : brut → conversion en euros → hors TVA → net de la commission de la plateforme → part du membre. Arrondi au centime après chacune de ces étapes et nulle part ailleurs, **demi qui s'éloigne de zéro** (symétrique), y compris pour les montants négatifs (malus, ajustements).
- Le taux de change utilisé (valeur, source, date), toutes les règles appliquées (taux du membre, TVA, commission, paliers, primes) et la version du moteur (`engine_version`) sont **copiés dans le relevé** : recalculer un relevé validé redonne le même résultat au centime, même après une évolution du moteur.
- États : `draft` (recalculé à chaque changement de ses entrées) → `validated` (figé, facture émise) → `paid` (immuable). Une correction après validation est une ligne d'ajustement sur la prochaine période ouverte, jamais une modification.
- **Immuabilité garantie par la base** : un trigger refuse tout `UPDATE` ou `DELETE` d'un relevé `validated` ou `paid`, sauf le passage `validated` → `paid`. Les lignes des relevés, `pay_adjustments` et `carry_overs` sont en ajout seul (`REVOKE UPDATE, DELETE` au rôle applicatif, comme les autres journaux).
- **Course entre un rapport tardif et la validation** : créer ou modifier un rapport et valider la période prennent le même verrou consultatif (membre, période). Le relevé garde un `inputs_hash` ; la validation répond 409 si un recalcul donne autre chose que le brouillon affiché.
- Unicités : un relevé par (membre, période), un report par (membre, période d'origine). Le recalcul est un job Graphile de `jobKey` (membre, période).
- Les malus sont plafonnés à la part du membre plus ses primes : un relevé n'est jamais négatif. Un total sous le minimum de versement est reporté sur la période suivante par un registre idempotent.
- **Rémunération à la commission seulement**, comme dans Imperium (Charles, 27/10) : pas de taux horaire. Un manager peut toucher une part du net de l'équipe.
- Périodes : quinzaines (1-15, 16-fin du mois) dans le fuseau de l'agence, un nouveau réglage (Europe/Paris par défaut). Un shift à cheval sur deux périodes appartient à celle où il **commence**.
- Toute écriture passe par `audit_log` avec son auteur.

### Factures

Le chatteur est le fournisseur, l'agence le client : l'agence établit la facture **au nom et pour le compte** du chatteur (autofacturation, art. 289 I-2 du CGI), comme Imperium. Les règles suivantes sont celles qu'un comptable exige ; le comptable de l'agence valide le mandat, les mentions et la première facture réelle avant la mise en service.

- **Mandat de facturation** accepté dans l'application avant la première facture, avec le contrat de prestation (version du texte, date, empreinte gardées). Il couvre toutes les factures de commissions du contrat et leurs avoirs, fixe le délai de contestation et dit que le prestataire reçoit sa copie par l'application. Sans mandat en vigueur, la validation produit le relevé mais aucune facture.
- **Chaque facture est acceptée** par le prestataire (BOI-TVA-DECLA-30-20-10-30 § 150-160) : il l'accepte ou la conteste avec un motif ; sans réponse à la fin du délai du mandat, elle est acceptée tacitement. Chaque étape est datée dans `audit_log`.
- **Une séquence de numéros par prestataire** (BOI-TVA-DECLA-30-20-20-10 § 120-130) : chronologique, continue, avec un préfixe propre au prestataire, jamais mêlée aux factures d'un autre. Le compteur est une ligne par (prestataire, année) verrouillée `FOR UPDATE` dans la transaction qui crée la facture, jamais une `sequence` Postgres (un rollback y laisse un trou).
- **Figée à l'émission** : la facture naît dans la transaction de validation, avec ses lignes, ses mentions, les coordonnées des deux parties et sa date d'émission copiées. Son PDF est rendu une fois depuis ces données, gardé avec son empreinte, et plus jamais régénéré.
- **TVA** : la prestation d'un prestataire non établi en France est taxable en France chez l'agence, qui autoliquide la TVA (art. 283-2 du CGI). La facture porte « Autoliquidation » et aucune TVA facturée. Le régime de chaque prestataire (mentions, TVA, retenue) vient d'un réglage par pays validé par le comptable ; un pays non paramétré ne reçoit pas de facture.
- **Retenue à la source** (art. 182 B du CGI, 25 % sur les prestations utilisées en France par un non-résident) : écartée quand la convention fiscale avec le pays du prestataire réserve l'imposition à ce pays. Le dossier prestataire garde l'attestation de résidence fiscale datée ; manquante ou de plus d'un an, la validation affiche un avertissement.
- **Contenu** : commissions par compte, primes et paliers, malus en lignes négatives (réfactions prévues au contrat), total hors taxe. Un montant reporté reste facturé dans sa période : le report retarde le versement, pas la facture.
- **Une facture émise ne change jamais** : une erreur se corrige par un avoir de la même séquence qui cite la facture d'origine et suit la même acceptation ; un oubli en faveur du prestataire devient une ligne de régularisation sur la facture suivante, avec sa période d'origine.
- **Paiement et piste d'audit** : « payée » porte la date, le moyen, la référence du transfert et le montant envoyé. On remonte de la facture aux rapports et ventes qui la justifient, et on descend au transfert qui la solde (piste d'audit fiable, art. 289 VII du CGI).
- **Conservation** dix ans (art. L123-22 du Code de commerce), dans le format d'origine.
- **Réforme de la facturation électronique** : la facture d'un prestataire établi hors de France ne passe pas par les plateformes agréées ; l'agence déclare ces achats en e-reporting par sa plateforme agréée (au 1er septembre 2027 pour une PME). Chaque facture garde ses données structurées pour l'alimenter ; le format d'échange se décide avec cette plateforme.
- **Export comptable** par période : journal des achats (comptes paramétrables, validés par le comptable) et PDF des factures et avoirs.
- **Vocabulaire** : ce que reçoit le prestataire dit « relevé de commissions », « facture », « avoir », jamais « fiche de paie », « salaire » ni « sanction ».

### Mode hybride

- Nouveau motif de passage à l'humain : `sale`. Le code le pose à l'endroit exact où `offerDecision` autoriserait un script, à la place de ce script. Il hérite donc de tout ce qui bloque déjà une offre : drapeaux du fan, risques, délai entre deux offres, fan qui ne sexualise pas.
- **Un passage `sale` vaut une offre pour le délai** entre deux offres (10 h pour Messa), qu'il aboutisse ou non : deux messages d'affilée du fan ne produisent qu'un seul `sale`.
- `sale` n'est pas un risque : il ne déclenche pas `protectionFor`, ni l'alerte de passation « Il n'écrit plus à ce fan » (il a son propre texte), et il ne compte pas dans le taux en réel de l'ADR 0019. Dans `HANDOFF_CAUSES`, son rang est « important », jamais « urgent » : le rouge reste au mineur, au consentement et à la détresse. Ajouter `sale` à `HandoffCauseSchema` change un contrat lu par le Dashboard : la modification passe par le propriétaire de `packages/contracts`, avec son texte dans `WHY` (supervision) et la migration qui élargit les contrôles de type d'événements.
- Un réglage par créatrice, « Qui vend » : l'agent, l'équipe, ou les deux. Avec « l'équipe » ou « les deux », le `sale` part au membre en poste sur cette créatrice. **Sans personne en poste**, avec « l'équipe », l'agent continue la relation sans vendre (comme une offre refusée par la politique), l'occasion est notée dans Suivi et le `sale` part au premier membre qui prend son poste ; avec « les deux », l'agent vend. Aucun fan n'attend parce que personne n'est en poste.
- **Pas de reproposition** : le brief de passation liste les packs déjà refusés et les scripts déjà joués. Un refus obtenu par le chatteur est enregistré comme un refus de l'agent ; un manque d'argent avoué au chatteur pose le drapeau « ventes gelées » (`money_trouble`). La règle « rien après un manque d'argent » vaut donc pour tous.
- **Gardes sur les messages du chatteur** : la vente se fait depuis Suivi. Un message écrit ou retouché par le chatteur repasse les gardes dures avant l'envoi (G5) : pas d'IA avouée, pas de rencontre, pas d'amour promis. Écrire directement dans Reveal reste possible mais sort de tout contrôle ; ce risque est écrit dans `docs/conventions/security.md` par la fiche hybride.
- **Rendre la main** porte une issue fermée, `releaseOutcome` (`sold` | `refused` | `none`), en plus de la note libre « À retenir sur ce fan » : le code décide de la suite (règle 3 de `CLAUDE.md`). Après un achat, l'agent fait l'aftercare ; après un refus déjà traité par l'humain, il ne boude pas (une seule bouderie par refus).
- Une vente détectée revient au membre qui tenait la conversation à cet instant (le journal garde qui a pris la main et quand) ; sinon à l'agent, sans commission.
- Rien ne change pour le mode Copilote ni pour l'Automatique (ADR 0019) : les messages de relation de l'agent restent validés tant que l'Automatique est fermé.

### Données et RLS

- `withMember(db, session, fn)`, posé par le propriétaire de `packages/db` au premier lot, fixe `app.user_id` et `app.team_scope` (`self` | `agency`) par `set_config(…, true)`. Le serveur calcule le scope dans la même transaction : `agency` pour le propriétaire ou un manager actif, `self` sinon ; il n'est jamais lu dans la requête. Les politiques sont fermées par défaut : un réglage absent ou nul ne rend aucune ligne.
- Les tables de l'équipe et de la paie, sans `creator_id`, ne suivent que cette politique : un membre lit ses lignes, le scope `agency` lit tout.
- Shifts, rapports, congés et échanges portent `creator_id` **et** `member_id` : la RLS demande les deux, la créatrice **et** (`member_id` = moi ou scope `agency`). Sinon deux chatteurs d'une même créatrice liraient les montants, donc la paie, l'un de l'autre.
- Le job de paie lit les rapports de plusieurs créatrices par une boucle `withTenant` par créatrice, ou par une lecture `withAdmin` bornée dans ce seul job. Aucune politique n'est élargie « pour la paie ».
- « Qui est en poste », vu par la créatrice, passe par une vue qui ne rend que le nom affiché et le créneau, jamais `team_members` (taux, pays).
- Un membre marqué parti perd l'accès dans la même transaction : `creator_ids` vidé, sessions révoquées. Ses factures et relevés restent, conservation oblige.
- Toutes les migrations de ces lots passent par le propriétaire de `packages/db`, une par PR.
- **L'historique d'Imperium est repris** (Charles, 27/10) : membres, rapports, relevés payés, primes, malus, reports et factures émises, avec leurs numéros d'origine, en lecture seule et marqués « importé d'Imperium ». Le script d'import vit dans le dépôt et se teste sur des données inventées ; il lit la base d'Imperium sur le PC de Charles, et aucune donnée réelle n'entre jamais dans le dépôt (ADR 0010). Les coordonnées bancaires ne sont pas importées. Les nouvelles factures ouvrent les séquences par prestataire.

### Navigation

Un onglet **Équipe** (Membres, Planning, Rapports, Paie) pour le propriétaire et les managers. Un chatteur a un espace resserré : Suivi, Mon planning, Mes rapports, Mes commissions (relevés et factures). La créatrice a sa PWA. Sur téléphone, la barre garde au plus cinq onglets ; la disposition se décide avec le design system.

### Ordre

Lot 0 (cet ADR, le glossaire, les fiches) → 1 Équipe → 2 Planning → 3 Rapports, paie, factures, puis import de l'historique → 4 Hybride (après la capture Reveal et les clés) → 5 PWA de la créatrice → ensuite, les autres fonctions d'Imperium, reprises elles aussi : facturation des créatrices et pénalités de retard, rapprochement bancaire, ventes Telegram Stars, trafic des liens, coaching, gamification. Les lots 1 à 3 n'attendent que du code.

## Conséquences

- Les nouveaux chatteurs sont gérés dans le même outil que l'agent, avec la même authentification et le même design.
- La paie devient vérifiable : un relevé contient tout ce qui l'explique, et un test peut le recalculer.
- Les factures tiennent devant un contrôle : mandat, acceptation, séquence par prestataire, mentions, avoirs, piste d'audit, conservation.
- Le rapport de fin de shift reste une déclaration : sa justesse dépend de la validation par un humain tant que le connecteur ne lit pas les ventes.
- Deux dépendances nouvelles se décident dans leurs fiches : la génération de PDF et, si besoin, une bibliothèque de tests par propriétés.

## Alternatives rejetées

- **Relancer Imperium à côté** et le relier par l'API : deux piles, deux authentifications, un design daté, et le parsing Telegram dont Charles ne veut plus.
- **Porter le code d'Imperium** : contraire à la règle des concepts ; JavaScript, SQLite et logique dans les routes.
- **Additionner déclaré et détecté** sur un même compte : double comptage dès que le connecteur lit les ventes.
- **Un rôle d'accès `manager`** : il dupliquerait toutes les règles d'`operator` ; un rôle d'équipe suffit.
- **Une séquence de factures commune à tous les prestataires** : le BOFiP demande une séquence propre à chaque fournisseur quand le client établit ses factures.
