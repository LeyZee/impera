# 2026-11-16 : ADR 0132, paliers de dépense par créatrice

- **Fiche** : ADR 0132 (fil « Adapter l'IA aux gros dépensiers »), aucune fiche de code avant « ok 0132 ».
- **Fait** : ADR 0132 acceptée par Charles le 16/11 à 15 h 38 (« ok 0132 ») : source de la dépense (plateforme), jusqu'à cinq paliers par créatrice, registres de l'IA, bornes en code, gros dépensier en difficulté passé à un humain, palier sur la fiche et dans le copilote. Glossaire : deux termes. Aucun code.
- **Tests** : aucun (documentation seule).
- **Reste** : fiches des lots a à e ; test Reveal « même média à deux prix » sur « test » (mot de Charles requis) avant le lot a bis.
- **Découvertes** : l’agent lit la dépense sur les messages payés stockés (`situation.spentCents`) ; le palier part du registre des ventes, repli `totalSpent` (relecture Bilan).
