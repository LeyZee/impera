# SC-03 Dossier de script rangé dans l'ordre, et export ZIP
Statut : in-progress (ADR 0056 acceptée le 03/11/2026 ; lots a, b et c1 faits)
Phase : scripts (ADR 0056)
Dépend de : SC-02
Branche : task/sc-03-ordered-script-folder

## Objectif
Chaque script envoyé est nommé et rangé selon la nomenclature de l'ADR 0056 § 5, cartons compris, et s'exporte en ZIP ordonné avec une fiche à recopier tant que le connecteur ne sait pas écrire dans Reveal.

## Contexte à lire
ADR 0056 (§ 5 et § 7), ADR 0044 § 2 (effacement), le stockage objet de CR-06.

## À faire
- [x] Domaine pur (lot a, `content-drops/domain/script-naming.ts`) : nom de dossier `S<nnn>-<moment>-<thème>`, nom de fichier `<pp>-<code>-<ii>-<sorte>.<ext>`, slug ASCII ; test : l'ordre alphabétique égale l'ordre du script pour des structures avec ponts et variantes.
- [x] Numéro de script sans trou par créatrice, donné à l'envoi (lot b, migration 0128).
- [ ] Le moment d'une structure « les deux » (question posée à Charles le 06/11).
- [x] Cartons PNG en `00` de chaque série (lot c1) ; toujours mis pour l'instant.
- [ ] Le réglage par créatrice des cartons dans le dossier (activé par défaut).
- [x] Export ZIP dans l'ordre, en flux, et fiche à recopier (étapes, intentions, séries et fichiers) (lot c1, `GET /v1/creators/:creatorId/drops/:id/script-export`).
- [ ] Textes validés (SC-05) et prix de la grille (P6-01) dans la fiche.
- [ ] Export confirmé par l'équipe, qui fait partir les 30 jours, et l'écran de l'agence (lot c2, migration à attribuer).

## Critères d'acceptation
- Tests de nomenclature (positions à deux chiffres, `00` réservé, pas d'espace ni d'emoji) ; numéro de script concurrent sans doublon.

## Hors périmètre
Téléversement dans Reveal (SC-06).

## Notes de session
- 06/11, lot a : nomenclature pure et ses tests ; le numéro sans trou (migration) et le moment d'une structure « les deux » restent au lot b.
- 06/11, lot b : `content_drops.script_number`, donné à l'envoi sous un verrou consultatif, unique par créatrice ; test de deux envois simultanés (2 et 3).
- 06/11, lot c1 : `domain/script-export.ts` (plan de l'archive et fiche), `application/script-export.ts` (ZIP fflate en flux, chaque média lu du stockage au fil de l'eau), `DropStorage.read`, `AgencyContentStore.sentScript` sous RLS. Refus avant le premier octet : pas un script numéroté, pas encore prêt, original effacé, structure « les deux ». Sans migration.
