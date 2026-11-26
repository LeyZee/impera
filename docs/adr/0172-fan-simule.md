# 0172. Un fan joué par une IA teste l'agent sur des semaines fictives

Statut : proposed (demande de Charles du 26/11/2026, « Fiche de démo d'abord » le même soir, casting de 8 fans et fantasme précis le même soir)
Date : 2026-11-26
Précise : 0009 (évaluations), 0102/0103 (Playground), 0010 (données fictives). Ne remplace rien.

## Contexte

1. Les évaluations (`pnpm evals`) jouent des fans écrits d'avance, sur 1 à 6 messages. Elles mesurent des moments, pas une relation : rien ne dit si la conversation avance ou tourne en rond après dix jours.
2. Le Playground joue déjà le chemin de la prod (cerveau, politique, voix, gardes, filet de sécurité, attente) avec une horloge simulée, des achats fictifs et un catalogue d'essai. Il lui manque un fan qui réponde seul.
3. Une IA qui joue un rôle est complaisante : elle répond à tout et achète. Une IA qui note les mots d'une IA de la même famille est trop indulgente.

## Décision

1. **Une commande, `pnpm fan-sim`**, qui fait parler un fan simulé avec la session du Playground (`createPlaygroundSession`), sans aucun connecteur : rien ne peut partir vers une plateforme.
2. **Chaque fan est une fiche YAML versionnée** (`evals/fans/<id>.yaml`), inventée de bout en bout ; un casting de 8 fans très différents (Charles, 26/11), chacun avec son ton, sa façon d'écrire, son vécu et 3 à 5 comportements à des jours fixés. Leur façon d'écrire s'inspire de traits généraux tirés du corpus anonymisé (hors dépôt), jamais d'une phrase réelle : identité, vie, caractère, goûts, ce qu'il refuse, budget du mois, jour de paie. Aucune donnée réelle (règle de `CLAUDE.md`).
3. **Le calendrier est tenu par le code, pas par le modèle.** La fiche donne des sessions datées en jours fictifs (jour, heure locale, nombre de messages au plus) et des événements imposés (il disparaît, sa paie arrive, il se blesse, il marchande). Entre deux sessions, la commande avance l'horloge du Playground et demande les relances comme la prod.
4. **Un état caché, tenu par le code** : envie, confiance, agacement (0 à 10) et argent restant ce mois-ci. Le modèle du fan propose à chaque message un écart borné (± 2) et un journal intérieur ; le code applique les bornes. Il n'achète l'étape payante que si l'envie et la confiance passent les seuils de sa fiche et qu'il a l'argent ; sinon le code refuse pour lui. Le journal n'entre jamais dans ce que lit la créatrice.
5. **Trois familles de modèles.** La créatrice garde la configuration de la prod (Grok). Le fan est joué par une autre famille (Gemini 3.8 Flash, rapide, sinon Mistral Large). Le juge par Mistral Large (sinon Gemini) : jamais la famille de la voix.
6. **Le fan et le juge passent par `@impera/llm`** (`createFanSimulationGateway` : `simulateFan`, `judgeRelationship`), chacun sur le rôle `judge` d'une configuration propre, prompts `judge/fan-simulation.md` et `judge/relationship-example.md`, sorties validées par Zod, journal en mémoire et plafond du lancement. Le `LlmGateway` de la prod ne change pas ; aucune migration.
7. **Le juge « relation » est hors du dépôt public.** Son barème décrit la méthode de l'agence : il est lu depuis un fichier passé en argument (`--rubric`), jamais commité. Le dépôt garde un barème d'exemple inventé pour les tests.
8. **Le fantasme d'abord** (Charles, 26/11 : « le but c'est l'argent »). Chaque fiche porte un fantasme principal précis et les scripts du catalogue de test qui y répondent (`evals/fans/catalogue.yaml`, un thème par script) ; certains fans en ont un qu'aucun script ne couvre. Le juge note si elle l'a trouvé, quand, si elle y revient et si elle choisit le script le plus proche ou un sur-mesure. Un fantasme entre adultes qu'il amène se joue à fond ; seul un âge douteux arrête tout.
9. **Mesures par le code** : cases de la note remplies et à quel jour, faits datés repris d'elle-même, répétitions (phrases, images, question de fin), offres (quand, prix, issue), courbes d'envie et de confiance jour par jour.
10. **Sorties** sous `.scratch/` seulement : la conversation complète, le journal du fan, `chiffres.json`. Avec la fiche de démo, elles peuvent être relues hors du PC ; avec la vraie fiche (`--persona-from-crm`), seuls les chiffres sortent.
11. **Coût annoncé avant chaque lancement**, plafond par lancement (`--cap-eur`, 15 € au plus), à part et en plus du plafond du jour.

## Conséquences

- On mesure enfin la relation dans la durée : un fan qui revient après 4 jours, un fait raconté le 10e jour et repris le 14e, une vente au bon moment après la paie.
- Un tirage reste un tirage : un 30 jours se lit comme une conversation à relire, pas comme une note fiable. On compare deux versions de l'agent sur le même fan et la même graine.
- Le fan reste une IA : il ne remplace ni le Playground de Charles ni les vrais fans.
