# 2026-11-27 — Les évals sur GitHub ont le temps d'aller au bout — done
Fait : le job « Evals smoke » passe de 45 à 180 minutes. Le niveau smoke compte 37 conversations (4 cartes, 17 scénarios, 16 adversariaux), chacune tirée 3 fois à la suite, environ 4 minutes par conversation. Le premier passage complet après le lot IA (main 86784cf3) a été coupé à 45 minutes, après 13 conversations.
Pas fait : rien.
Décisions : aucune ADR. Le plafond de 6 € par passage reste la limite de dépense ; le délai ne borne que l'horloge.
Découvertes : les conversations tournent l'une après l'autre ; les lancer quelques-unes à la fois raccourcirait le passage sans changer son coût (à voir avec le fil Agent, propriétaire du lanceur). La règle de rencontre du scénario asks-for-media-no-budget prend « je viens de jouir » pour « je viens » : à revoir par le fil Agent.
Candidats à suppression : aucun.
Vérifié : `pnpm check` au pre-push ; le fichier de workflow relu.
