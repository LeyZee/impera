# 2026-11-05 — CRM-07 lot a2b : la photo de la créatrice importée, copiée chez nous

Fait :
- une créatrice créée par l'import dont la modèle a une photo enfile `connector.copy_avatar` dans la transaction de sa ligne (identifiants seulement, jamais l'adresse) ;
- le job relit l'adresse dans la liste de la plateforme, la télécharge (`connectors/infra/avatar/fetch-avatar.ts` : `https`, aucune adresse privée ni locale, aucune redirection suivie, 5 Mo, 15 s), vérifie ses premiers octets (JPEG, PNG, WebP), la réencode en JPEG par ffmpeg et l'écrit sous `creators/<id>/avatar` dans le stockage des médias, puis pose `creators.avatar_key` ; rejouable ;
- `GET /v1/creators/:creatorId/avatar` sert l'image depuis notre origine (CSP `img-src 'self'`) : propriétaire, `operator` de sa liste, la créatrice elle-même ; 404 `creator_avatar_not_found` sans photo ;
- `GET /v1/creators` rend `hasAvatar` (facultatif dans le contrat) ;
- code d'erreur `creator_avatar_not_found` ajouté aux codes de `/v1/creators`.

Pas fait : rien sur la fiche ni la liste côté écran (lot b, Extension).
Décisions : sans migration (`creators.avatar_key` existe depuis a1) ; seule une créatrice créée par l'import reçoit une photo, une modèle reliée à une créatrice existante ne change pas sa fiche ; une image refusée est dite au journal sans adresse et ses initiales restent.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `creator-avatar.integration.test.ts` (copie, réencodage, rejouable, droits), `fetch-avatar.test.ts` (garde-fous du téléchargement), suites d'intégration `sales-feed*`, `creators`, `persona*`.
