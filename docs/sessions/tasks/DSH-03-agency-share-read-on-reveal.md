# DSH-03 La part de l'agence lue chez Reveal, le pourcentage facultatif
Statut : review
Phase : pilotage (ADR 0054, amendement du 14/11/2026, § 4 à § 8)
Dépend de : CR-04 (pourcentage de l'agence), CRM-04 lot d3 (contrôle des pourcentages), registre des ventes (ADR 0050)
Branche : claude/project-thread-t7tj46
Propriétaire : fil « Afficher parts modèle, agence et TVA » ; relecteurs Équipe (scheduling), Bilan (base, événements), Design (fiche, mise en route)

## Objectif
Reveal donne déjà la part de l'agence sur chaque vente : ne plus demander au propriétaire de la saisir. La fiche de la créatrice montre la part constatée, une alerte prévient si elle change d'une quinzaine à l'autre, et le pourcentage devient facultatif.

## Contexte à lire
ADR 0054 (§ 2, puis l'amendement § 4 à § 8), ADR 0042 § 6, glossaire « Part constatée » et « Changement de part ».

## À faire
- [x] Amendement de l'ADR 0054 (« ok phrases 0054 », 14/11).
- [x] Contrat : `observed` (30 jours, trois dernières quinzaines) dans `CreatorAgencyRateList` ; événement `agency_share_changed`.
- [x] Domaine `scheduling` : `observedShares`, `agencyShareChanges` (plus d'un point), testés.
- [x] Job `scheduling.check_agency_shares` : publie aussi `agency_share_changed`, une fois par compte, quinzaine et devise (index unique, migration 0199 provisoire, déclencheur Telegram).
- [x] Telegram : « Important », groupes « pour toutes », la plateforme et la quinzaine, jamais une part.
- [x] Mise en route : la ligne « La part de l'agence » est faite dès qu'un compte Reveal est relié au flux des ventes.
- [x] Écran Créatrices › Part de l'agence : la part lue d'abord, le pourcentage facultatif ; tests.
- [ ] Captures validées par Charles (données inventées).
- [ ] Au tour de fusion : numéro, idx et `when` de la migration confirmés au-dessus de `main`, contraintes reprenant tous les types d'événements de `main`.

## Critères d'acceptation
- Aucun montant ne vient du pourcentage ni de la part constatée ; la paie ne lit ni l'un ni l'autre.
- La part constatée est servie au propriétaire seul.
- L'alerte de changement est publiée une seule fois par compte, quinzaine et devise, sans fan ni chatteur.
- Aucune valeur réelle (pourcentage, part, vente) dans les tests, la doc ou les captures.

## Hors périmètre
Lire un pourcentage « contractuel » chez Reveal (l'API ne l'expose pas : la part est lue vente par vente).
