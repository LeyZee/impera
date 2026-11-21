# 2026-11-16 — CRE-05 « Mot de passe oublié » sans Telegram — done
Fait : phrase « Pas de Telegram lié ? Demande un nouveau lien à ton agence. » sur la page « Mot de passe oublié », avant et après la demande ; test d'intégration du lien `reset` du propriétaire pour une créatrice et un chatteur (refus des autres rôles et sans connexion récente, usage unique, sessions fermées, membre parti refusé).
Pas fait : écran côté propriétaire (les boutons existent, présentation pour le fil Design).
Décisions : aucune nouvelle route ni table, aucun ADR : le lien `reset` du propriétaire existe déjà (EQ-10, CR-02) et l'ADR 0068 le cite.
Découvertes : la phrase du serveur après une demande dit « demande à un autre propriétaire », juste pour le propriétaire, moins pour une créatrice ; la phrase de la page la complète. Les deux liens diffèrent (72 h et code remis à zéro pour celui du propriétaire, 15 min et code gardé pour Telegram) : voulu par EQ-10, ADR 0046 § 2 et ADR 0068 § 3.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ ; intégration en CI (pas de Docker ici).
