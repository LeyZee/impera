# evals/

Évaluations du moteur IA (ADR 0009, `docs/conventions/testing.md`, playbook `write-an-eval.md`). Chaque scénario passe par le même chemin qu'un vrai message (cerveau, politique, voix, gardes dures), puis le juge note la réponse. Rien n'est envoyé ; la persona est la persona de démo, fictive (ADR 0010), sauf avec `--persona-from-crm` (plus bas).

```
scenarios/      comportement attendu : KYC, mémoire, relance, médias, langue, curseur de sexualisation, offre, délai, refus de prix, objections et répliques de la banque, demande sur mesure, pack refusé, manque d'argent, ventes gelées
adversarial/    le fan attaque : injection (directe, jeu de rôle, en plusieurs messages), « t'es un bot ? », rencontre, contact ou paiement hors plateforme, promesse d'amour, mineur, détresse, harcèlement, produit dangereux, abus réel
regression/     bugs réels rejoués (nommés par fiche de tâche)
card/           la fiche du fan lue dans ses messages (ADR 0085 § 7, `fans.read_card`) : ce que la lecture doit proposer, une fois vérifié par le code, et ce qu'elle ne doit jamais écrire ; sans juge
thresholds.json seuils par critère pour `smoke` (CI, chaque semaine et à chaque changement de l'IA) et `full`
run.ts          garde : refuse une suite trop courte ou sans clé, puis lance l'exécuteur
probe/          test express d'un modèle (`pnpm probe`)
fans/           fans simulés inventés et leur catalogue à thèmes (`pnpm fan-sim`) : des semaines de conversation jouées par un modèle d'une autre famille que la voix
```

L'exécuteur vit dans `apps/api/src/scripts/evals.ts` (il appelle le code de l'agent) ; le format d'un scénario est `apps/api/src/scripts/evals/scenario.ts`, les vérifications `apps/api/src/scripts/evals/check.ts`. Les rubriques du juge sont dans `packages/llm/prompts/judge/`.

Commandes : `pnpm evals` (smoke : tout sauf `tier: full`), `pnpm evals -- --full`, `pnpm evals -- --file evals/adversarial/asks-if-bot.yaml` (chemin depuis la racine).

Jeux : `pnpm evals -- --full --match compliment-` rejoue seuls les scénarios dont le nom de fichier contient `compliment-` (le jeu « compliments » de Charles, 20/11 : onze compliments sans rien de sexuel, accueillis avec assurance et un merci, sans commentaire sur l’audace ni le rythme du fan). On le rejoue à chaque changement du cerveau, de la voix ou de leurs consignes.

Tirages : chaque scénario est tiré trois fois (`--draws`, de 1 à 5). La voix est réglée pour varier, et un seul tirage peut passer ou échouer par hasard. Un scénario échoue si un de ses tirages échoue ; ses notes sont la moyenne des tirages, et son minimum (`judge:` du scénario) se lit sur le pire tirage.

Conversations en parallèle : l'exécuteur joue quatre scénarios à la fois (`--concurrency`, de 1 à 8, ou la variable `EVALS_CONCURRENCY` ; `--concurrency 1` les joue l'un après l'autre comme avant le 27/11). Les tirages d'un même scénario restent l'un après l'autre. Le rapport garde l'ordre des fichiers, quel que soit celui qui finit le premier, et chaque scénario s'affiche d'un bloc. Un scénario qui plante échoue seul (« erreur : … »), les autres sont joués, et la passe échoue. Le coût ne change pas : ce sont les mêmes appels, seulement plus serrés dans le temps.

Persona en vigueur : `pnpm evals -- --key-from-crm --persona-from-crm` fait passer les scénarios sur la persona active de la créatrice dans la base de `.env` (`--creator <id>` s'il y en a plusieurs), lue sur une connexion qui ne peut pas écrire. On ne le lance que sur le PC qui tient la base : les réponses affichées sont écrites dans sa voix, elles ne se collent ni dans une PR, ni dans le chat, ni dans `/mnt/project-files`. Seuls les comptes (scénarios passés, moyennes, échecs par nom de scénario) en sortent. Un scénario qui attend un fait de la persona de démo (son prénom, sa ville, ses goûts) échoue alors sans que l'agent ait tort : un tel échec se lit comme un faux rouge, pas comme une régression.

Juge : il note mieux ce qu'un autre modèle a écrit. L'exécuteur prend Mistral, sinon Gemini, dès que leur clé existe ; avec la seule clé xAI, le juge est Grok comme la voix et le rapport le dit : ces notes-là sont à lire avec ce biais d'auto-évaluation, et ne suffisent pas à ouvrir l'Automatique (ADR 0019 exige aussi le test à l'aveugle). Une réponse du juge illisible (aucune, incomplète, ou toutes les notes à 0) est redemandée une fois ; toutes à 0 deux fois, la réponse est écartée des moyennes et nommée à la fin (« Juge illisible »), jamais comptée 0 ; un juge qui ne répond jamais fait échouer le scénario. La transcription donne la raison du juge pour toute safety sous 1 et tout critère sous 0,5 (« pourquoi … »). Le moment donné au juge tient compte d'un âge adulte qu'il vient d'écrire, comme l'agent (`withAgeDeclared`).

Coût : chaque passage a son propre plafond de 6 € (`EVALS_CAP_EUR`, relevé de 3 € pour les trois tirages, choix de Charles du 12/11), à part des 25 €/jour de l'agent (20 € jusqu'au 21/11, choix de Charles) ; au plafond, la suite s'arrête et échoue. Avec plusieurs scénarios en cours, le plafond tient : un scénario seul démarre tant que la passe est sous le plafond (comme avant), et il ne rejoint ceux en cours que si le dépensé, plus le pire cas de chaque scénario en cours et du sien, reste sous le plafond ; sinon il attend qu'un finisse. Le pire cas d'un scénario est son nombre de tours fois ses tirages, chaque tour compté 0,10 € (environ sept fois un tour mesuré) ou au prix du tour le plus cher déjà mesuré dans la passe s'il coûte plus. Trois tirages de la suite smoke coûtent environ 3,40 USD.

Règles : données fictives uniquement ; résultats collés dans la PR ; on n'abaisse jamais un seuil pour passer la CI ; le naturel de `smoke` est passé de 0,75 à 0,80 le 27/11 (Charles), comme celui de `full` ; `smoke` ≤ 37 scénarios.

## Fans simulés (`pnpm fan-sim`)

Un fan inventé (`evals/fans/<id>.yaml` : sa vie, sa façon d'écrire, son fantasme principal, son argent, ses sessions datées) parle au Playground sur des jours simulés. Le code tient son état caché et décide ses achats ; le modèle du fan (Gemini, sinon Mistral, jamais celui de la voix) écrit ses messages et son journal intérieur. Elle vend dans `evals/fans/catalogue.yaml`, un script par thème, pour vérifier qu'elle choisit celui qui colle à son fantasme. À la fin, un juge d'une autre famille lit la conversation, le journal et les mesures du code.

`pnpm fan-sim --fan evals/fans/julien.yaml --days 7 --cap-eur 5` : semaine 1 de Julien. `--rubric <fichier>` donne le barème de l'agence, gardé hors du dépôt ; sans lui, le barème d'exemple inventé (`packages/llm/prompts/judge/relationship-example.md`). Persona de démo, sorties sous `.scratch/fan-sim/<id>/` : `conversation.md`, `conversation-et-journal.md`, `chiffres.json`, `juge.json`. Plafond par lancement : 15 € au plus, annoncé à Charles avant.
