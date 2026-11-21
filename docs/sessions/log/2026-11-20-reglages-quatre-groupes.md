# 2026-11-20 — Navigation, lot 3 : Réglages en quatre groupes, trois écrans renommés — done (PR à ouvrir à son tour)
Fait : la liste de Réglages se range en quatre groupes titrés (ADR 0134 § 6) : Connexions (Plateformes, Bots Telegram), IA (Modèles IA, Consommation IA), Argent (Règles de paie, Facturation), Sécurité (Alertes, Sauvegardes, Sécurité). « Ventes » devient « Plateformes », « Telegram » devient « Bots Telegram », et le sous-onglet « Reveal » d'Équipe devient « Comptes Reveal » (§ 5). Les adresses ne changent pas. Réglages s'ouvre sur Plateformes, sa première ligne. Les phrases de l'application qui nommaient ces écrans suivent. Glossaire : une ligne pour les trois noms.
Pas fait : rien d'autre ne bouge dans ces écrans.
Décisions : aucune ADR nouvelle.
Découvertes : des textes écrits par le serveur nomment encore « Réglages › Ventes », « Réglages › Telegram » et « Équipe › Reveal » (modules `telegram` et `supervision`, `packages/contracts`, runbooks et docs de recette) ; à renommer par les fils propriétaires.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests web des écrans touchés, captures du lot `reglages-quatre-groupes-1`.
