# 2026-11-16 : ADR 0135, time waster

- **Fiche** : ADR 0135 (fil « Gérer les fans qui font perdre du temps »), acceptée par Charles le 16/11 à 15 h 08 ; aucune fiche de code encore.
- **Fait** : ADR 0135 : définition par le code (dépense lue de l'ADR 0132, offres vues, aide au paiement donnée), deux niveaux, attention rare (délais, réponses groupées, registre `busy`, file, relances coupées), garde `money_reproach`, bouderie étendue, sortie au premier achat, pastille dans le copilote, témoin et arrêt automatique. Glossaire : « Time waster ». Aucun code.
- **Tests** : aucun (documentation seule).
- **Reste** : fiches des lots a à d ; comptage des acheteurs tardifs (§ 4) par Bilan avant la mise en service.
- **Découvertes** : le registre `busy` s'ajoute à `SpenderRegister` de l'ADR 0132 (PR #819) : à fusionner après elle.
