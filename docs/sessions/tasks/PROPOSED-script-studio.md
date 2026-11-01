# Atelier de scripts : OnlyScript refait de zéro dans Nirvana
Statut : proposed (second temps ; Charles, 27/10/2026, 15h11 : « les scripts (OnlyScript) avec le système des cartons en mieux travaillé… revoir tout le système pour que ça soit mieux construit, plus robuste et fiable et mieux codé »)
Phase : 6 (commerce avancé), après la capture Reveal et P6-01
Dépend de : P6-01 (catalogue tarifé), le rôle `sense` (médias décrits), la persona (dégoûts), une ADR à écrire avant le code
Branche : task/<id>-script-studio

## Objectif
Construire et tenir les scripts de vente de l'agence dans Nirvana : une structure en étapes séparées par des cartons, des médias décrits, des prix tenus par le code, des statistiques par étape, dans le même design que le reste.

## Contexte à lire
`docs/reference/legacy-projects.md` (§ OnlyScript : la vision du sexting, les cartons, l'identité de script, « le modèle décrit, le code décide »), `docs/reference/media-vocabulary.md`, `docs/glossary.md` (Carton), `docs/architecture/modules.md` (module `scripts`, non créé), P6-01, ADR 0018 (les scripts natifs de Reveal), la persona (`personas/`), la méthode de chatting (hors dépôt). Le dépôt `LeyZee/onlyscript` se lit pour ses concepts seulement, jamais son code (décision de Charles).

## Question à trancher d'abord (ADR)
P6-01, validée le 17/10, fait de Reveal la source des scripts : on les crée dans Reveal, Nirvana les indexe. Un atelier fait de Nirvana l'endroit où l'on écrit les scripts. Il faut choisir comment ils arrivent dans Reveal (écriture par le connecteur derrière la garde d'écriture de l'ADR 0018, ou fiche guidée que l'équipe recopie) et lequel des deux fait foi ensuite, sans casser la règle « Reveal fait foi pour ce qui a déjà été envoyé à un fan ».

## Pistes (à préciser après l'ADR)
- Un script : identité (nom, thème, moment jour ou nuit), étapes dans l'ordre d'intensité, un carton entre deux étapes, chaque étape avec ses médias décrits et son prix.
- Règles dans le code : dégoûts de la persona, prix et écarts entre étapes (avertissements de P6-01), aucun média sans description, un script jamais rejoué au même fan.
- Aide à l'écriture : le modèle propose textes et ordre à partir des descriptions, le code valide ; versions gardées.
- Statistiques par script et par étape (taux d'achat, revenus), une fois les ventes détectées ; les chatteurs voient les scripts dans le brief de passation (EQ-08).

## Hors périmètre
Génération de médias, envoi de masse.

## Notes de session
