# Coffre Reveal : importer les scripts existants et les relier aux médias du coffre
Statut : in_progress (lancée par la coordination le 14/11/2026 ; ID à donner ; ADR 0099 temps 2, P6-01 ; propriétaire proposé : Médias pour le module `scripts`, Bilan pour la lecture Reveal déjà dans P2-02)
Phase : 6
Dépend de : P2-02 (`listScripts`), `PROPOSED-vault-sync.md`, P6-01, SC-04 c8 (identité de script, rattachable à un script de toute origine)
Branche : task/<id>-vault-import-scripts

## Objectif
Les séquences de scripts déjà dans Reveal deviennent des scripts d'Impera, reliés aux liaisons de leurs médias, avec leurs prix lus dans Reveal, et proposables dès que leurs médias et leur identité sont validés.

## Contexte à lire
ADR 0099 (§ 1, § 3), ADR 0098 (déroulé et clés de segment), P6-01, `docs/reference/reveal-connector-spec.md` § 6, fiche SC-04 (lot c8).

## À faire
- [x] Table des scripts importés nommée dans la fiche à son démarrage, `creator_id` sous FORCE RLS, migration dont le numéro est demandé au coordinateur. Tables `platform_scripts`, `platform_script_steps`, `platform_script_step_media` ; migration 0201, numéro provisoire confirmé au signal.
- [x] Import des séquences et de leurs étapes dans l'ordre de `stepIndex` ; un script disparu de Reveal est désactivé, jamais supprimé.
- [x] Prix de chaque étape lu dans la séquence Reveal, repris tel quel par la synthèse (remarque Médias, point 5). Le prix Reveal est facultatif et lu en centimes TTC en euros ; le plafond de P6-01 vaut 40 € TTC (Charles, 14/11/2026). Avertissement à l'import pour un palier plus du double ou au-dessus du plafond, calculé à la lecture, jamais un blocage.
- [x] Un média d'étape absent du coffre rend l'étape incomplète, donc le script non proposable.
- [x] Un script importé garde le nom de Reveal.
- [x] « Proposable » = chaque média a une description validée **et** l'identité du script (schéma c8, unique) est validée (remarque Médias, point 6). Tant que c8 n'existe pas, aucun script natif n'est proposable.
- [ ] Brancher le job `scripts.import_platform_scripts` (un compte, demandé avec chaque synchronisation du coffre, sans horloge) sur la lecture des scripts de `connectors` et les liaisons du coffre (`media_platform_refs`) quand la synchronisation du coffre (`PROPOSED-vault-sync.md`, Bilan, #759) est dans main.

## Critères d'acceptation
- Tests contre `FakeReveal` : script modifié resynchronisé, script supprimé désactivé, ordre des étapes respecté, prix repris tel quel, script non proposable tant qu'une description ou l'identité manque.

## Hors périmètre
Création de scripts dans Reveal, écriture des textes par l'IA.

## Notes de session
- 14/11/2026 (Médias) : domaine, tables, import et lectures écrits et testés contre FakeReveal (scénario `sequence_removed` ajouté). Reste le branchement du job sur la lecture de `connectors` et sur les liaisons du coffre, qui arrivent avec la PR de la synchronisation du coffre.
