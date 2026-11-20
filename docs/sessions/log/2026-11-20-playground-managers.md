# 2026-11-20 — Playground : ouvert aux managers actifs, pour les créatrices de leur liste — done

Fait : trou 11 de la liste du 20/11 (ADR 0092 § 8). Un manager actif (`teamScope` agence) ouvre Entraîner › Chatting, entrée « Entraîner » dans son menu. Le serveur le laisse jouer les créatrices de sa liste seulement (`creator_forbidden` sinon), lit ses scripts comme il les lit, et le ramène à la persona inventée quand elle quitte sa liste. Décision de Charles (« il note, toi tu ranges ») : il note et corrige, ses notes comptent dans le taux ; l'Exemple de voix et « Retirer » restent au propriétaire (`voice_bank_owner_forbidden`), sa correction est gardée en Règle. L'écran ne lui montre ni Post du canal (adresse ramenée au Playground), ni lien vers Modèles IA, ni « Retirer ». Le test des alertes reste au propriétaire.
Pas fait : un écran où le propriétaire relit les corrections gardées en Règle et les range en Exemple de voix d'un clic.
Décisions : avenant du 20/11 à l'ADR 0092 (le manager note, le propriétaire range).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests du Playground (serveur et câblage 108), contrats 500, écran.
