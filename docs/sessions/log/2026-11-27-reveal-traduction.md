# 2026-11-27 — Reveal envoie ses réglages de traduction avec les messages — done
Fait : la page des messages d'une conversation porte depuis le 27/11 un champ racine `translation` (langue de l'équipe, du fan, de la réponse) ; la forme stricte de `messages.list` le refusait, donc toute lecture de messages échouait en `shape_changed`. `wire.ts` le lit, facultatif et strict à l'intérieur, sans s'en servir : la langue de réponse reste décidée par notre code.
Pas fait : les autres nouveautés de la même capture (épinglage pour soi ou pour l'équipe, adhésions aux listes, dernier script envoyé, files « nouveaux abonnés » et « ventes PPV », vérification de message avant envoi, boîte coupée en deux) attendent l'avis de Charles.
Décisions : aucune.
Découvertes : voir « Pas fait ».
Candidats à suppression : rien.
Vérifié : tests du connecteur Reveal (dont deux nouveaux : la page avec `translation` passe, une clé inconnue dedans est refusée), formes relevées par le PC sur la capture de Charles, sans aucune valeur.
