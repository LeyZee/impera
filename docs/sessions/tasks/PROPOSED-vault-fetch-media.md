# Coffre Reveal : lire les fichiers le temps de la description, garder la vignette seule
Statut : proposed (ID à donner ; ADR 0099 § 5 et § 7 ; propriétaire proposé : Bilan, modules `connectors` et `media`)
Phase : 6
Dépend de : `PROPOSED-vault-sync.md`, P2-02, première lecture réelle des liens de médias (validité, flux vidéo découpé)
Branche : task/<id>-vault-fetch-media

## Objectif
Chaque média synchronisé est lu une fois sur Reveal, décrit par le rôle `sense` en détail (ADR 0083), réduit à une vignette floutée, puis ses octets sont effacés.

## Contexte à lire
ADR 0018 (`fetchMedia`, drapeau `mediaDownload`), ADR 0030 § 3 et § 4, ADR 0083, ADR 0089, ADR 0099 § 5, `apps/api/src/modules/media/` (`descriptionKey`, `keyframeRate`, `spreadFrames`), `docs/reference/reveal-api-observed.md` (« Ce qui reste ouvert », point 7).

## À faire
- [ ] `fetchMedia` dans `FakeReveal` d'abord (photo, vidéo simple et vidéo en flux découpé, liens qui expirent), puis dans l'adaptateur Reveal.
- [ ] Description par lots ordonnés : d'abord les médias des scripts importés, puis le reste ; arrêt au plafond du jour du budget IA ; reprise le lendemain sans doublon.
- [ ] Vidéo : images clés et transcription extraites du flux ; si le flux ne se lit pas, le média attend un texte de l'agence (« À décrire par l'agence »), jamais une description inventée.
- [ ] Octets lus puis effacés dès la fin du job : aucune ligne d'original gardée, aucune rétention ADR 0044 (remarque Médias sur #709, point 2) ; vignette sous sa clé `thumbnail_key`.
- [ ] Lien expiré : relire la liste du dossier pour un lien frais, une fois, puis échec typé.

## Critères d'acceptation
- Tests contre `FakeReveal` : photo et vidéo décrites, octets absents du stockage après le job, vignette présente ; lien expiré relu une fois ; plafond atteint = arrêt propre et reprise.
- Aucun média réel dans le dépôt : fichiers de test générés.

## Hors périmètre
Validation humaine des descriptions (écran), média envoyé par un fan.

## Notes de session
