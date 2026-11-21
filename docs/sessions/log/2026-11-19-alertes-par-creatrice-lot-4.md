# 2026-11-19 — Alertes par créatrice, lot 4 (onglet Alertes de la fiche) — in progress
Fait : l'onglet « Alertes » de la fiche créatrice (propriétaire seul, après Canal Telegram) : une carte par famille (Sécurité, Ventes, Conversation, Système), sur ordinateur un tableau dont les trois rôles titrent les colonnes, sur téléphone une ligne par rôle avec les mots ; le choix Reçoit / Sourdine / Rien est le contrôle segmenté du design system (flèches, focus itinérant, bulle au survol) ; le relais de sécurité est verrouillé (« Reçoit toujours ») ; « Personne ne reçoit cette alerte » en ambre ; enregistrement optimiste, la ligne revient et l'erreur s'affiche si le serveur refuse. Tests du composant (familles, verrou, enregistrement, flèches, avertissement, échec).
Pas fait : les notifications de la créatrice par sorte dans Moi › Notifications (ADR 0150 § E bis), dans une PR suivante.
Décisions : aucune nouvelle ; l'écran suit l'ADR 0150 et l'avis de Design (une carte par sujet, icônes, aucune couleur par famille).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires de `apps/web/src/creators` ✓, typecheck ✓, lint ✓ ; captures Nuit/Jour, PC/téléphone avec des données inventées.
