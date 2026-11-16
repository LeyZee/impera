# 2026-11-16 : ADR 0128, ménager les scripts (pause après achat, rejeu par variante, stock)

- **Fiche** : ADR 0128 (fil « Économiser les scripts de vente »), en `proposed`.
- **Fait** : ADR 0128 : pause après un achat de script (24 à 72 h, levée s'il sexualise ou demande), rejeu d'un script sans achat par une variante de teasing jamais reçue (`unseen_variant`), demande de script avancée quand le stock par acheteur actif baisse (origine `stock`). Glossaire : trois termes. Aucun code.
- **Tests** : aucun (documentation seule).
- **Reste** : « ok 0128 » et les quatre questions ouvertes ; capture sur le compte « test » d'un renvoi de la même étape payante (§ 13) ; puis Bilan (migration, contrat), Agent et Médias, Design.
- **Découvertes** : l'atelier gère déjà trois variantes par étape (ADR 0056) ; la cadence ne regarde pas le stock ; le média reçu compte aujourd'hui les médias vendus d'une étape payante envoyée et non achetée (ADR 0098 § 6), à corriger avec le rejeu.
