# EQ-03 Rapport de fin de shift dans Nirvana
Statut : in_progress (lot 3 de l'ADR 0023, ID validé par Charles le 27/10/2026 ; contrat fusionné #241, migration 0026 acceptée par Bilan (#243), module serveur et écrans écrits, incident marqué au planning ; restent l'incident dans À traiter et la lecture serveur des shifts finis sans rapport)
Phase : équipe (ADR 0023)
Dépend de : EQ-02 ; pour l'écran, EQ-11
Branche : task/eq-03-shift-reports

## Objectif
Le chatteur déclare à la fin de son shift ce qu'il a généré, directement dans l'application ; un manager le valide ; ces montants nourrissent la paie des comptes en source « déclaré ». Remplace les rapports postés dans Telegram puis lus par un bot dans Imperium.

## Contexte à lire
`docs/adr/0023-team-management.md` (« Une seule source de revenus par compte »), ADR 0011, `docs/design/README.md`.

## À faire
- [x] Contrats : `ShiftReport` (shift, montant brut en unités mineures et devise du compte, commentaire, incident éventuel), états `submitted` → `validated` | `rejected`, avec auteur et date de chaque transition.
- [x] Domaine pur : un rapport par shift (idempotence), montant borné, une période verrouillée refuse toute création ou modification, une correction après validation passe par un nouveau rapport d'ajustement lié. Écart écrit dans les notes (ADR 0023) : un rapport tardif n'est jamais refusé, la paie le porte sur la période ouverte suivante.
- [x] Base (via le propriétaire de `packages/db`, migration 0026) : `shift_reports` avec `creator_id` et `member_id`, unicité par shift, `audit_log`. RLS sur les deux : la créatrice **et** (le membre lui-même ou le scope `agency`), sinon deux chatteurs d'une même créatrice liraient leurs montants.
- [x] Créer ou modifier un rapport prend le verrou consultatif (membre, période) que prend aussi la validation de la paie. Un shift appartient à la période où il commence, dans le fuseau de l'agence.
- [x] Réglage du compte plateforme : source de revenus `declared` | `detected`, qui ne change qu'à une frontière de période (règles de paie d'un compte, datées par quinzaine ; « détecté » refusé tant que P6-01 n'enregistre pas les ventes).
- [x] Écrans, à la place que fixe l'ADR 0024 : « Faire mon rapport » au bout du shift (trois champs, envoi en un geste, annulable quelques secondes comme l'était une vente dans Imperium), les rapports passés du chatteur, les rapports de l'équipe à valider en lot, avec annulation de quelques secondes.
- [x] Incident sur le planning : un rapport qui signale un incident le montre sur le shift dans le planning (EQ-02).
- [ ] Incident dans À traiter : il crée une ligne importante dans À traiter du manager en poste ou du propriétaire (avec la file du shift non pris, EQ-12).
- [ ] Lecture serveur des shifts finis sans rapport, toutes quinzaines confondues (découverte de la relecture de #319) : Équipe › Rapports ne voit les retards que sur la quinzaine en cours et la précédente, en lisant les deux listes ; un shift plus ancien resté sans rapport n'y apparaît pas. Un rapport en retard n'est jamais refusé : la paie le reporte sur la première quinzaine ouverte (ADR 0023, note du 28/10 ci-dessous).

## Critères d'acceptation
- Tests : double envoi du même rapport sans doublon, période verrouillée, ajustement après validation, un compte en « détecté » n'accepte pas de montant déclaré pour cette période, shift commencé le 15 à 23 h rangé dans la première quinzaine.
- Test d'intégration RLS : un chatteur ne lit pas le rapport d'un autre chatteur de la même créatrice.
- Aucune dépendance à Telegram.
- Finition (Charles, 27/10, 15h22 : « que ce soit vraiment très joli… des hovers partout… une belle hiérarchie des informations ») : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, bureau et téléphone, mouvement réduit).

## Hors périmètre
Calcul de la paie, ventes détectées par le connecteur.

## Notes de session
- 2026-10-28 (fil Équipe) : contrat (`packages/contracts/src/pay-periods.ts`, `pay-rules.ts`, `shift-reports.ts`), d'accord avec Bilan sur trois points : migration 0026 ; les paramètres de paie des plateformes d'EQ-01 deviennent les **règles de paie d'un compte** (devise, TVA, commission de la plateforme, source de revenus), datées par quinzaine, en ajout seul, une par compte et par quinzaine (contrainte unique), taux en points de base entiers ; le fuseau des quinzaines est celui de la grille (`SchedulingSettings.timeZone`), et chaque rapport garde la quinzaine de son shift, lue à l'écriture. Écarts à la fiche, par l'ADR 0023 : « une période verrouillée refuse toute création ou modification » devient la règle d'Imperium reprise par l'ADR (§ Les règles d'Imperium, § Paie) : un rapport tardif n'est jamais refusé, la paie (EQ-04) le porte sur la période ouverte suivante ; ce qui ne change jamais, c'est un rapport validé (une correction liée, validée comme un rapport). Le test « période verrouillée » devient donc, en EQ-04, « rapport tardif porté sur la période suivante ». Choix : un rapport s'ouvre 30 minutes avant la fin du shift ; seul le membre du shift fait son rapport, une correction peut venir de l'agence (un remboursement) ; personne ne valide le rapport de son propre shift, ni un manager une correction qu'il a faite (quatre yeux, relecture de Bilan ; le propriétaire valide les siennes, comme pour un congé) ; la validation refait sous le verrou le contrôle du total validé du shift (jamais sous 0) ; la validation en lot répond rapport par rapport et nomme la version lue ; « renvoyé » = `rejected`, que le membre renvoie, changé ou tel quel ; « annulable quelques secondes » = l'écran attend avant d'envoyer, rien à défaire au serveur ; « détecté » refusé tant que le connecteur n'enregistre pas les ventes (P6-01). Reste : tables et RLS (0026), module, écrans, l'incident sur le shift du planning et dans À traiter.
- 2026-10-28 (fil Équipe) : migration 0026 (`shift_reports`, `account_pay_rules`) avec ses politiques, ses déclencheurs et 11 tests RLS (`packages/db/src/shift-reports-rls.integration.test.ts`). Reste : module, écrans, incident.
- 2026-10-28 (fil Équipe) : module serveur dans `scheduling` (rapports et règles de paie, routes du contrat), verrou (membre, quinzaine) `lockMemberPeriod` dans `@nirvana/db`, annulation d'un shift rapporté refusée en 409. Les règles de paie vivent dans `scheduling`, où les rapports les lisent sous le verrou. Reste : écrans, incident sur le planning et dans À traiter.
- 2026-10-28 (fil Équipe) : écrans. Aujourd'hui (« Faire mon rapport », mes rapports de la quinzaine, corrections), Équipe › Rapports (validation en lot, renvoi avec un mot, quinzaine par membre, correction de l'agence), Réglages › Règles de paie (propriétaire). Envoi et validation en lot annulables cinq secondes côté écran, envoyés quand même si la page se ferme. L'incident marque son shift dans Équipe › Planning, dont la fiche dit le rapport. Captures : https://claude.ai/artifact/5coPSwUvjFdN2ynEVAJ1pz. Reste : l'incident dans À traiter, avec la file du shift non pris (EQ-12).
- 2026-10-31 (fil Équipe, passe sur les fiches) : ajoutée la lecture serveur des shifts finis sans rapport, que la vue des retards de #319 ne couvre que sur deux quinzaines.
