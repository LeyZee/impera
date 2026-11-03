# Module `scripts`

**Rôle.** Les scripts que la créatrice tourne carton par carton (ADR 0056). Pour l'instant (SC-01 lots a et b) : l'atelier des **structures** de l'agence, leurs versions, la **file de structures** de chaque créatrice et le rendu des **cartons**. Viendront la demande de script et son parcours (SC-02), la nomenclature et l'export (SC-03).

**Peut dépendre de.** aucun module métier (feuille). Les limites de la persona lui viennent de `persona` par le composition root (`limitsOf`, sa version active).

**Tables possédées.** `script_structures`, `script_structure_versions` et `script_structure_queue` (migrations 0084 et 0091).

- La bibliothèque (`script_structures`, `script_structure_versions`) appartient à l'agence : hors RLS des créatrices, sous les politiques de l'équipe (`withMember`). Le propriétaire écrit, le propriétaire et les managers actifs lisent, personne d'autre (un chatteur, un compte de créatrice : rien).
- Une version porte le nom, le moment et les segments (`ScriptSegment[]`, relus par le contrat). La dernière version change sur place tant qu'elle n'est pas figée ; une fois figée (`frozen_at`, posée par `structures.freeze` quand une demande la prend, SC-02), un enregistrement écrit la version suivante (règle 6). Un déclencheur refuse toute modification d'une version figée, tout changement de numéro et toute suppression, pour tous les rôles.
- Une structure retirée est archivée (`archived_at`), jamais supprimée ; l'archivage la sort de toutes les files.
- La file (`script_structure_queue`) est par créatrice, sous sa RLS et les mêmes portées (`withTenantMember`) : un compte de la créatrice n'en lit rien. Elle se remplace en entier, sous un verrou par créatrice.

**Règles** (contrat `packages/contracts/src/scripts.ts`, partagé avec l'écran) : `scriptStructureFaults` (au moins une étape ; clés uniques ; une étape a un emplacement ; lettres de variantes uniques, trois au plus ; un pont relie par leurs clés l'étape juste avant lui et celle juste après, un seul pont entre deux étapes) et `scriptSegmentCodes` (numéros dérivés de l'ordre, `E<n>` et `P<n><m>`). Dans le domaine : `disgustBlocks` (une étape qui touche `never_do`, `never_show` ou `disgusts` de sa persona, un pont dont l'accroche touche `never_say` ou `disgusts`, en mots entiers, lu en code), `saveDecision` (règle 6), `queueView`.

**Routes** (montées sous `/v1`, codes d'erreur `SCRIPT_ERROR_CODES`) :

- `GET /script-structures`, `GET /script-structures/:structureId` : propriétaire et opérateurs (la RLS ne montre rien à un chatteur) ;
- `POST /script-structures` (propriétaire) : écrit la structure et sa version 1 sous l'identifiant du client (201) ; le même envoi rejoue (200) ; le même identifiant avec un autre contenu donne 409 `script_structure_conflict`. Une règle cassée donne 400 avec le message à la place du segment fautif ;
- `PUT /script-structures/:structureId` (propriétaire) : enregistre sur `basedOnVersion` ; 409 `script_structure_stale_conflict` si une autre version a été écrite depuis ; 400 `script_structure_creator_invalid` si la créatrice réservée n'existe pas ou si la structure est déjà dans la file d'une autre ;
- `DELETE /script-structures/:structureId` (propriétaire) : archive (204) ;
- `GET /creators/:creatorId/script-queue` : la file, chaque entrée avec ce qui la bloque aujourd'hui (`blocks`) ; `personaChecked` vaut `false` sans persona active ;
- `PUT /creators/:creatorId/script-queue` (propriétaire) : remplace la file ; 422 `script_queue_structure_unprocessable` (inconnue, archivée, réservée à une autre) ou 422 `script_queue_disgust_unprocessable` avec, par structure, l'étape et l'entrée de sa persona qui bloquent.

- `GET /script-structures/:structureId/cards/:segmentKey?format=card|folder|thumbnail&variant=A|B|C` : le carton d'un segment de la version courante, ou d'une de ses séries. `card` (défaut) rend le SVG pour l'application, `folder` un PNG de 1080 × 1080 pour le dossier, `thumbnail` un PNG de 320 × 320 pour les chatteurs. 404 `script_card_not_found` pour une clé ou une variante absente.

**Cartons** (`domain/cards.ts`, ADR 0056 § 3 et ADR 0064). Le dessin d'OnlyScript dans la typographie de Nirvana : la **couleur du script** (trois tons, `color` de la version) en dégradé sur tout le carton, « ÉTAPE n » et le nom de l'étape au centre, l'intention entre guillemets avec « (GRATUIT) » ou « (PAYANT) » (`access` de l'étape), ce qu'il faut tourner, les indications (trois au moins quand il y en a), l'ambiance, et en pied une case par série. Une variante a son carton de série (« Série A », sa consigne, une flèche) ; un pont dit « PONT n & m », son teaser, toujours « (GRATUIT) », sa photo teasing, et porte une arche. La vignette des chatteurs ne garde que l'étape, son nom et ce qu'il faut tourner. Le code choisit l'encre (claire ou foncée) qui se lit sur les trois tons ; une couleur où aucune n'atteint 4,5:1 est refusée à l'enregistrement (`ReadableScriptColorSchema`). Fonction pure : les mêmes octets pour la même entrée. Le texte de l'agence est échappé ; le SVG ne nomme ni fichier, ni image, ni lien, et la route l'envoie avec `Content-Security-Policy: default-src 'none'`. Le PNG est tiré par ffmpeg et son décodeur librsvg (`infra/card-rasterizer.ts`, aucune dépendance nouvelle), avec une configuration de polices qui ne nomme que `infra/fonts/` (Geist et Instrument Serif en TTF, SIL OFL 1.1, licences à côté) : le même SVG donne le même PNG dans une même image Docker (une autre version de librsvg, pango ou freetype peut changer l'anticrénelage, on ne compare donc jamais un PNG d'une machine à l'autre). Deux rendus au plus tournent en même temps. L'image Docker copie ce dossier comme celui des factures, et sa construction échoue si l'ffmpeg d'Alpine n'a pas librsvg.

Chaque écriture ajoute une ligne `script_structure.create`, `.update`, `.archive`, `.freeze` ou `script_queue.update` dans `audit_log`.

## Structure

- `domain/` : limites de la persona, décision d'enregistrement, vue de la file, cartons, ports `ScriptStructureStore` et `RasterizeCard`. Zéro I/O.
- `infra/db/` : les tables, chaque ligne relue par le contrat.
- `infra/http/` : les routes.
- `infra/card-rasterizer.ts` et `infra/fonts/` : le PNG d'un carton.
