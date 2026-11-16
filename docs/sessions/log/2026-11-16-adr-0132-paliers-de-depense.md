# 2026-11-16 : ADR 0132, paliers de dépense par créatrice

- **Fiche** : ADR 0132 (fil « Adapter l'IA aux gros dépensiers »), aucune fiche de code avant « ok 0132 ».
- **Fait** : ADR 0132 proposée : source de la dépense (plateforme), jusqu'à cinq paliers par créatrice, registres de l'IA, bornes en code, gros dépensier en difficulté passé à un humain, palier sur la fiche et dans le copilote. Glossaire : deux termes. Aucun code.
- **Tests** : aucun (documentation seule).
- **Reste** : relectures Agent, Bilan et Scripts à branches (vocabulaire de la fiche avec l'ADR 0131) ; deux questions à Charles ; puis fiches de lots.
- **Découvertes** : l'agent lit la dépense sur les messages payés stockés (`situation.spentCents`), pas sur `getFanProfile.totalSpentMinor` ; le lot a de l'ADR 0132 l'aligne.
