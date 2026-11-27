# 2026-11-16 — DSH-04 Périodes du calendrier et comparaison choisie — done
Fait : ADR 0146 (acceptée par Charles le 17/11) ; contrat, domaine et lecteur des jours du calendrier (jour, semaine, mois, personnalisé) avec comparaison choisie ; écran avec flèches, listes, courbe au survol (bulle dans la zone de la courbe, compacte au téléphone) et comparaison en pointillé ; option `search` du Select ; tests unitaires, d'intégration et d'écran ; quatre lots de captures (le 4e validé par Charles) ; main ramené après #852.
Pas fait : couleurs de la courbe et des parts, mini-courbes par tuile (lot suivant, teintes portées par Design).
Décisions : une période en cours se compare sur autant de jours ; pas de pourcentage quand le registre commence après la période comparée ; la courbe part du premier jour du registre ; jamais de rouge pour un mauvais chiffre.
Découvertes : Reveal compte chaque abonnement gratuit comme une vente (nombre de ventes et panier moyen différents d'Impera) ; ses vues modèle et agence ne sont pas recalculées à la même heure ; une seule vente du registre est antérieure à novembre, nature à vérifier sur le PC.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓, CI complète ✓ (intégration comprise).
