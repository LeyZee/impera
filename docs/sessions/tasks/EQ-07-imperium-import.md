# EQ-07 Import de l'historique d'Imperium (optionnel)
Statut : blocked (ID validé par Charles le 27/10/2026 ; optionnelle : aucune copie de la base d'Imperium, son serveur est arrêté. Charles, 27/10 à 14h34 : « on se remet au propre sur une nouvelle base ». Ne se lance que si une sauvegarde est retrouvée et que Charles le redemande.)
Phase : équipe (ADR 0023)
Dépend de : EQ-01 à EQ-06, une copie de la base d'Imperium
Branche : task/eq-07-imperium-import

## Objectif
Retrouver dans Nirvana l'historique d'Imperium (membres, shifts, rapports, relevés payés, primes, malus, reports, factures émises) en lecture seule, avec des totaux identiques au centime près à ceux d'Imperium, sans qu'aucune donnée réelle n'entre dans le dépôt.

## Contexte à lire
`docs/adr/0023-team-management.md` (§ Les règles d'Imperium, § Données et RLS), ADR 0010, ADR 0011, `docs/reference/legacy-projects.md`, `docs/conventions/security.md`. Imperium stocke tout dans une base SQLite, sur son ancien serveur et dans ses sauvegardes ; Charles en pose une copie sur son PC (tables `chatteurs`, `plateformes`, `shifts`, `shift_reports`, `ventes`, `paies`, `paie_reports`, `malus`, `primes_manuelles`, `paliers_primes`, `objectifs_collectifs`, `paliers_collectifs`, `taux_change`, `factures`).

## À faire
- [ ] Script `apps/api/src/scripts/import-imperium.ts` (à côté des scripts existants de `apps/api/src/scripts/`) : lit le fichier SQLite dont le chemin est passé en argument, écrit par les cas d'usage des modules (jamais en SQL direct dans les tables), idempotent par une clé d'origine (`legacy_ref` : table et identifiant Imperium).
- [ ] Correspondances : chatteur → membre (statut actif ou parti, taux de commission) ; plateforme → paramètres de paie ; shift, rapport, vente → leurs équivalents ; paie payée → relevé `paid` avec `engine_version = imperium`, jamais recalculé ; prime, malus, report → leurs lignes ; facture → facture importée avec son numéro d'origine, marquée « importée d'Imperium », hors des séquences par prestataire. Les montants en flottants passent en unités mineures avec l'arrondi de l'ADR.
- [ ] Report repris d'Imperium (ADR 0038) : un report positif entre au rang 2, pour que la première quinzaine de Nirvana le verse même sous le minimum (Imperium ne comptait pas les reports successifs, et sa facture peut déjà être ancienne) ; un report négatif entre au rang 1. Le déclencheur `keep_carry_over` (migration 0043) veut aujourd'hui le rang 1 sans report avant, et un relevé validé de Nirvana : la migration de l'import l'adapte aux lignes importées.
- [ ] Mode `--dry-run` par défaut : rapport des comptes par table et des totaux par période et par membre, comparés à ceux d'Imperium ; tout écart au-delà d'un centime par relevé est listé et bloque l'import réel.
- [ ] Pas importé : coordonnées bancaires, mots de passe et jetons, journaux Telegram, données de Qonto, tout ce qui touche aux créatrices au-delà de leurs comptes plateforme.
- [ ] Exécution sur le PC de Charles par une session Remote Control, d'abord vers la base locale, puis vers la base de production quand elle existe, chaque fois avec son accord écrit (règle 12) ; aucun fichier d'Imperium copié hors de son PC.

## Critères d'acceptation
- Tests sur une base SQLite fabriquée dans le test avec des données inventées : import complet, rejeu sans doublon, écart de total détecté, facture importée hors séquence.
- Après import, un relevé importé est en lecture seule (le trigger de la paie s'applique) et sa facture se télécharge si son PDF d'origine a été fourni.
- `gitleaks` passe et le dépôt ne contient que des données inventées ; le fichier réel ne quitte jamais le PC de Charles.

## Hors périmètre
Routine et projets des créatrices, facturation des créatrices, rapprochement bancaire (reprise avec leurs lots), nettoyage des données d'Imperium.

## Notes de session
