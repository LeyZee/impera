# 2026-11-16 — ADR 0147 Synchronisation de la session Reveal à l'ouverture du popup — accepted
Fait : ADR 0147 acceptée (l'extension synchronise seule la session Reveal quand le propriétaire ouvre le popup sur un onglet Reveal et que la session d'un compte déjà synchronisé expire ou a expiré ; sans rechargement ni appel à Reveal ; serveur arbitre, identité du compte de l'IA figée au premier clic, envoi au seul compte dont la modèle correspond ; ajouts de la relecture Sécurité). Index et glossaire (« Synchronisation à l'ouverture »).
Pas fait : le code (après #804, « ok 0147 » donné par Charles le 16/11 à 23 h 14), l'identifiant de la modèle dans la liste des comptes du connecteur, l'heure d'expiration renvoyée par le serveur (fil Bilan).
Décisions : ADR 0147 acceptée ; amende la fiche P2-01 sur la seule lecture « le temps du clic ».
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓ (docs seulement), hygiène ✓.
