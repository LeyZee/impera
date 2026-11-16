# 2026-11-16 : la politique de risque de la production au playground

- **Fiche** : recette agent/robustesse, constat AGE-01 (fil Playground).
- **Fait** : le filet en code (`safetySigns`) lu avant tout modèle comme en production : « 15 ans » écrit en clair est relayé sans appel au cerveau, « en finir » force le mode soin. Puis le playground applique `holdDecision` comme la production et les évals : mineur possible, demande dangereuse ou récit d'abus réel relayés à un humain sans appel à la voix ; détresse et automutilation en mode soin (rien n'est vendu) ; « attends, je reviens » : elle attend et n'écrit rien. Contrat : champ `hold` de `PlaygroundAnswerSchema`. Écran : bloc « Elle attend », sections « Mode soin » et « Décision du code » dans « Pourquoi », raisons du relais. « Bon réflexe » sur un relais de média ne répond plus 409. Avis Design : « Désir 0 inchangé », champ « Note d'abord son réflexe », pas de « Décision » quand le code attend.
- **Tests** : session (mineur, détresse, attente, cas normal), route (« Bon réflexe » sur un relais), écran (« Pourquoi », modèle).
- **Reste** : relance après une attente (`waited`) avec l'horloge simulée, affichage en deux temps et rythme des bulles, conversations en base (AGE-06), REG-03.
- **Découvertes** : aucune.
