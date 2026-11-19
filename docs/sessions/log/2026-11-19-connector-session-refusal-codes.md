# 2026-11-19 — connector-session-refusal-codes (refus de « Sync » distincts) — done
Fait : `POST /v1/connector/sessions` distingue trois refus 422 jusque-là confondus : `connector_session_expired_unprocessable` (jeton déjà expiré), `connector_session_member_unprocessable` (le jeton nomme un autre membre que celui lu dans l'onglet) et `connector_session_unprocessable` (forme illisible). Le lecteur de session Reveal rend `'member_mismatch'` au lieu de `null` pour le deuxième cas.
Pas fait : `sessionExpiresAt` dans la liste des comptes, demandé par le fil Extension : l'échéance n'est gardée que dans la session chiffrée, il faut une colonne et donc une migration (PR suivante).
Décisions : noms terminés par `_unprocessable`, car le statut HTTP suit le suffixe (`statusForCode`). Rien ne change à ce qui est accepté ou refusé.
Découvertes : la « Sync » de Charles échoue le 19/11 parce que l'extension retient le premier `/users/:id` vu dans l'onglet (un autre membre, ou `me` de la route nouvelle `/users/me/context`) au lieu du membre du jeton : correctif confié au fil Extension.
Candidats à suppression : aucun.
Vérifié : typecheck de apps/api, tests unitaires du module connectors (34 fichiers), prettier, eslint.
