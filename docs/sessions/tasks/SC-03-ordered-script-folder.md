# SC-03 Dossier de script rangé dans l'ordre, et export ZIP
Statut : in-progress (ADR 0056 acceptée le 03/11/2026 ; lots a et b faits)
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
- [ ] Cartons PNG en `00` de chaque segment, selon le réglage par créatrice.
- [ ] Export ZIP dans l'ordre et fiche à recopier (étapes, textes validés, prix de la grille), cochée par l'équipe ; l'export confirmé fait partir les 30 jours.

## Critères d'acceptation
- Tests de nomenclature (positions à deux chiffres, `00` réservé, pas d'espace ni d'emoji) ; numéro de script concurrent sans doublon.

## Hors périmètre
Téléversement dans Reveal (SC-06).

## Notes de session
- 06/11, lot a : nomenclature pure et ses tests ; le numéro sans trou (migration) et le moment d'une structure « les deux » restent au lot b.
- 06/11, lot b : `content_drops.script_number`, donné à l'envoi sous le verrou de la créatrice, unique par créatrice ; test de deux envois simultanés (2 et 3).
