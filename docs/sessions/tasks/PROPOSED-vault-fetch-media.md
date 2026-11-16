# Coffre Reveal : lire les fichiers le temps de la description, garder la vignette seule
Statut : in-progress (ID à donner ; ADR 0113 acceptée ; ADR 0099 § 5 et § 7 ; propriétaire proposé : Bilan, modules `connectors` et `media`). PR #773 : tout le code est là, reste la relecture et la première lecture réelle des liens.
Phase : 6
Dépend de : `PROPOSED-vault-sync.md`, P2-02, première lecture réelle des liens de médias (validité, flux vidéo découpé)
Branche : task/<id>-vault-fetch-media

## Objectif
Chaque média synchronisé est lu une fois sur Reveal, décrit par le rôle `sense` en détail (ADR 0083), réduit à une vignette floutée, puis ses octets sont effacés.

## Contexte à lire
ADR 0018 (`fetchMedia`, drapeau `mediaDownload`), ADR 0030 § 3 et § 4, ADR 0083, ADR 0089, ADR 0099 § 5, `apps/api/src/modules/media/` (`descriptionKey`, `keyframeRate`, `spreadFrames`), `docs/reference/reveal-api-observed.md` (« Ce qui reste ouvert », point 7).

## À faire
- [x] `fetchMedia` dans `FakeReveal` d'abord (photo, vidéo simple et vidéo en flux découpé, liens qui expirent), puis dans l'adaptateur Reveal.
- [x] Description par lots ordonnés (`media.describe_vault`) : d'abord les médias des scripts importés actifs, puis des autres scripts, puis le reste ; arrêt au plafond du jour du budget IA ; reprise chaque heure sans doublon (`media.describe_vault_backlog`).
- [x] Vidéo : images clés et transcription extraites du flux (recopié en MP4) ; si le flux ne se lit pas, le média attend un texte de l'agence (« À décrire par l'agence »), jamais une description inventée.
- [x] Octets lus puis effacés dès la fin du job : média né effacé (origine `vault`, migration 0215, numéro provisoire), aucune rétention ADR 0044 ; vignette sous sa clé `thumbnail_key`.
- [x] Lien expiré : relire la liste du dossier pour un lien frais, une fois, puis échec typé.

## Critères d'acceptation
- Tests contre `FakeReveal` : photo et vidéo décrites, octets absents du stockage après le job, vignette présente ; lien expiré relu une fois ; plafond atteint = arrêt propre et reprise.
- Aucun média réel dans le dépôt : fichiers de test générés.

## Hors périmètre
Validation humaine des descriptions (écran), média envoyé par un fan.

## Notes de session

- 16/11 (session vault-describe) : migration 0215 (provisoire), job `media.describe_vault` et son rattrapage horaire, lancé à la fin de chaque synchronisation. Reste : les tests d'intégration (`vault-describe.integration.test.ts`) n'ont pas tourné ici (pas de Docker), la CI les passe ; l'écran « décrits / à décrire » par dossier et la saisie du texte de l'agence pour un média sans fichier (hors périmètre) ; la liste d'hôtes et la validité réelle des liens à confirmer sur la première lecture réelle (L14, L15).
- 16/11 (session vault-describe-folders) : sur décision de Charles, seuls les médias d'un dossier du coffre sont décrits ; un média de la racine ne l'est jamais, même tenu par un script, et le rattrapage horaire ne le relance pas (ADR 0113 § 5 amendé). Le balayage des dossiers laissés par une course coupée passe de 15 min à 1 h (suite demandée par Sécurité).
