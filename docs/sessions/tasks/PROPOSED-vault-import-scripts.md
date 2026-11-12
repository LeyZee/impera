# Coffre Reveal : importer les scripts existants et les relier aux médias du coffre
Statut : proposed (ID à donner ; ADR 0099 temps 2, P6-01 ; propriétaire proposé : Médias pour le module `scripts`, Bilan pour la lecture Reveal déjà dans P2-02)
Phase : 6
Dépend de : P2-02 (`listScripts`), `PROPOSED-vault-sync.md`, P6-01, SC-04 c8 (identité de script)
Branche : task/<id>-vault-import-scripts

## Objectif
Les séquences de scripts déjà dans Reveal deviennent des scripts d'Impera, reliés aux liaisons de leurs médias, avec leurs prix lus dans Reveal, et proposables dès que leurs médias et leur identité sont validés.

## Contexte à lire
ADR 0099 (§ 1, § 3), ADR 0098 (déroulé et clés de segment), P6-01, `docs/reference/reveal-connector-spec.md` § 6, fiche SC-04 (lot c8).

## À faire
- [ ] Import des séquences et de leurs étapes dans l'ordre de `stepIndex` ; un script disparu de Reveal est désactivé, jamais supprimé.
- [ ] Prix de chaque étape lu dans la séquence Reveal, repris tel quel par la synthèse (remarque Médias, point 5) ; avertissement à l'import pour un palier plus du double ou au-dessus de 40 $ (P6-01).
- [ ] Un script importé garde le nom de Reveal.
- [ ] « Proposable » = chaque média a une description validée **et** l'identité du script (schéma c8, unique) est validée (remarque Médias, point 6).

## Critères d'acceptation
- Tests contre `FakeReveal` : script modifié resynchronisé, script supprimé désactivé, ordre des étapes respecté, prix repris tel quel, script non proposable tant qu'une description ou l'identité manque.

## Hors périmètre
Création de scripts dans Reveal, écriture des textes par l'IA.

## Notes de session
