# 2026-11-27 — SEC-18 : la première connexion survit à un rechargement — review
Fait : l'activation de la validation en deux étapes rend la même clé et les mêmes codes jusqu'au premier code ; le mot de passe n'est plus redemandé sur une session qui vient de le prouver ; les codes de secours et l'accueil sont retenus par deux marqueurs sur le compte ; l'écran reprend à la clé après un rechargement ; textes de l'étape de la clé corrigés.
Pas fait : captures (Design).
Décisions : Charles, 27/11/2026, sur les codes de secours réaffichés après un rechargement : « Oui, pendant 10 minutes ». Avenant à l'ADR 0046.
Découvertes : une activation en attente n'expire jamais (pas de date sur `two_factor`) ; l'avis de Sécurité « codes non notés » repose encore sur une marque du navigateur, posée désormais d'après le serveur.
Candidats à suppression : aucun.
Vérifié : tests web des écrans touchés ✓ ; intégration du deuxième facteur et des premiers pas ✓ ; pnpm check au pre-push.

Ajout après la demande de Design : les codes réaffichés disent pourquoi ils sont encore là et jusqu'à quelle heure (phrase en ambre ; le serveur rend `shownUntil`).

Découverte (relecture Design) : une fois les dix minutes passées, rien ne le dit à l'arrivée, seule la page Sécurité ; un rappel ailleurs (« À faire ») serait un ajout, pas fait.
