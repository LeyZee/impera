# 0138. Aperçu net du coffre : la petite image de Reveal lue à la demande, servie sans être gardée

Statut : accepted (Charles, 16/11/2026, 16 h 27, « ok 0138 » ; demande de Charles du 16/11/2026, 16 h 25, fil « Médias » : « je veux qu'on mette l'aperçu net, parce que c'est ça qui permet vraiment de me rendre compte de ce qu'on synchronise »)
Date : 2026-11-16
Précise : l'ADR 0099 (§ 7 : le téléchargement des octets, fiche à part), l'ADR 0030 (§ 4 : vignette affichée floutée par défaut), l'ADR 0018 (port du connecteur, lectures déclarées par drapeau). Amende : l'ADR 0099, où l'écran du coffre ne montrait aucun fichier tant que `fetchMedia` n'existait pas.

## Contexte

Le coffre se synchronise déjà en lecture seule : dossiers, médias, ordre de Reveal, texte et fourchette de prix (ADR 0099 §§ 2 à 4). L'écran montre chaque média par son aperçu flouté, le blurhash que Reveal calcule (quelques couleurs, jamais l'image).

Pour Charles, ce flou ne suffit pas : sans voir l'image, il ne sait pas ce qu'il synchronise ni ce qu'il mettra dans un script. Or `fetchMedia` (fiche `PROPOSED-vault-fetch-media.md`), qui lit l'original le temps de la description et garde une vignette, attend encore la première lecture réelle des liens et la description par la vision : elle ne sert pas à regarder son coffre aujourd'hui.

Reveal sert pour chaque média du coffre des liens de petite taille (`smallUrl`, et `thumbnailUrl` pour une vidéo), signés et de durée limitée (`docs/reference/reveal-api-observed.md`, point 7 encore ouvert).

## Décision

1. **Une lecture à la demande, rien de gardé.** Quand quelqu'un ouvre un dossier du coffre et demande l'aperçu net, le serveur lit à ce moment la liste de ce dossier dans Reveal pour avoir des liens frais, lit la petite image du média demandé, et la renvoie au navigateur. Aucun octet n'est écrit sur le disque ni en base. Aucun lien n'est écrit en base : les liens frais d'un dossier peuvent rester en mémoire du serveur quelques minutes, jamais plus longtemps que leur validité, pour ne pas relire le dossier à chaque image. La réponse porte `Cache-Control: no-store`.
2. **La petite taille seulement.** Une photo se lit par son lien de petite taille, une vidéo par son image d'aperçu ; un vocal n'a pas d'image. Jamais l'original, jamais le flux d'une vidéo. Une réponse de Reveal qui n'est pas une image, ou qui dépasse une taille plafond, est refusée.
3. **Floutée par défaut, nette sur un geste** (ADR 0030 § 4 inchangé). L'écran montre d'abord le blurhash. L'image nette se charge quand on demande « Voir net » dans un dossier ouvert, ou au survol d'un média, ou dans sa fiche. Rien ne se charge sur la liste des dossiers.
4. **Qui la voit.** Ceux qui lisent déjà le coffre : le propriétaire et un manager actif de la créatrice (le coffre sert à bâtir les scripts, contenu utile au chatting). Jamais un chatteur, jamais la créatrice dans son espace par cette route. La route vérifie la créatrice de la session, le compte et le média ; un média inconnu ou retiré de Reveal ne se lit pas.
5. **Par le connecteur, hôtes écrits dans le code.** La lecture est une méthode de lecture du port, déclarée par un drapeau (ADR 0018) : un connecteur sans ce drapeau n'est jamais appelé. L'adaptateur Reveal n'appelle que les hôtes écrits dans son code (ADR 0113 § 2), jamais un hôte lu dans une réponse sans contrôle ; tout ajout d'hôte passe par une PR relue par Sécurité. L'image d'aperçu d'une vidéo est un fichier du coffre : elle reçoit l'en-tête d'origine de l'hôte des vidéos comme les fichiers (avenant du 16/11 à l'ADR 0113 § 2), même hôte et même valeur fixe, rien d'autre (accord de Sécurité et de Bilan, 17/11/2026). Une erreur de Reveal compte pour le disjoncteur comme une autre lecture. Écrite d'abord dans `FakeReveal`, testée contre lui.
6. **Ce que ça ne change pas.** La description par la vision et la vignette gardée restent la fiche `fetchMedia` (ADR 0099 § 7). La synchronisation reste gratuite et sans fichier. Aucune donnée réelle dans le dépôt, les tests, les docs ni les captures : les images des tests et des captures sont générées.

## Conséquences

Positives :
- Charles voit ce qu'il synchronise, dossier par dossier, sans attendre la description par la vision ni payer d'appel d'IA.
- Rien d'intime ne s'accumule chez nous : pas de copie, pas de lien gardé en base.

Négatives :
- Chaque ouverture d'un dossier avec l'aperçu net relit ce dossier dans Reveal avec la session de la créatrice : plus d'appels à Reveal qu'une simple liste. Le geste explicite et la mémoire courte des liens le limitent.
- La durée de validité réelle des liens n'est pas encore connue : un lien expiré se relit une fois, puis l'écran retombe sur le flou, sans erreur bloquante.

## Alternatives rejetées

- **Montrer directement le lien de Reveal dans le navigateur.** Le navigateur appellerait un hôte tiers depuis le CRM, la politique de sécurité du CRM n'autorise que sa propre origine pour les images, et le lien signé passerait par la page.
- **Garder une vignette nette à la synchronisation.** C'est la fiche `fetchMedia` : une copie à protéger, et un travail plus long que le besoin du jour.
