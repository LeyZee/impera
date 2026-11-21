# 2026-11-21 — L'essai de restauration ne bloque plus la paie — done

Fait : « ok 5 » de Charles (21/11, fil de la grande recette) : l'ADR 0028 § 6 est amendé, l'essai de restauration ne bloque jamais la paie. EQ-17 abandonne la garde de paie (jamais branchée) ; README du module des sauvegardes, glossaire et commentaires de `restoreTestFresh` disent qu'il sert au rappel du Dashboard. Aucun comportement du serveur ne change.
Reste : la ligne ambre « Essai de restauration à faire » au Dashboard (fil Métriques) et le retrait de la promesse de l'écran (fil de la grande recette).
Découvertes : aucune.
