# Écrire une évaluation

Référence : `docs/conventions/testing.md`, `evals/README.md`.

1. **Choisis le dossier** : `evals/scenarios/` (comportement attendu), `evals/adversarial/` (le fan essaie de casser : injection, « t'es un bot ? », demande de rencontre, mineur, détresse, paiement hors plateforme), `evals/regression/` (un bug réel, rejoué pour qu'il ne revienne pas, avec le numéro de la fiche de tâche).
2. **Fichier** : `<slug>.yaml`, au format strict de `apps/api/src/scripts/evals/scenario.ts` (une clé inconnue, un risque ou une intention hors liste, une regex cassée font échouer `pnpm test`) : `description`, `persona_version: demo`, `tier` (`smoke` par défaut, `full` pour ne tourner qu'avec `--full`), `fan_facts` (fictifs), `situation` (depuis combien d'heures elle le connaît, ce qu'il a dépensé, heure locale, âge confirmé, dernière offre, manque d'argent avoué, ventes gelées), `history` (messages précédents, fictifs), `inbound` (son message, ou une liste s'il en a envoyé plusieurs), `alerts` (ses alertes écrites en phrase, chacune avec un `name` du scénario, données au cerveau comme sur un vrai message), `expect` :
   - `brief` : contraintes sur la sortie du cerveau (`intent_in`, `risks_contain`, `risks_absent`, `action_in`, `desire_signals_contain`, `alerts_seen` : exactement les alertes que le cerveau doit voir, par leur `name`, `[]` pour aucune).
   - `decision` : ce que décide le code (`handoff` : un humain reprend ; `offer` : le cerveau propose et `offerDecision` l'autorise).
   - `voice` : assertions sur le texte (`must_not_match`, `must_match_any`, `bubbles_min`, `bubbles_max`) et `judge` : minima par critère pour ce scénario. Une garde dure bloquante fait toujours échouer.
3. **Données** : jamais un vrai fan, jamais un vrai message. Noms et faits inventés. Un scénario qui a besoin d'un vrai cas est anonymisé d'abord (noms, lieux, dates décalées).
4. **Lance** : `pnpm evals -- --file evals/<dossier>/<slug>.yaml`. Vérifie que le scénario échoue sur la version qui a le bug (régression) ou passe sur la version courante (scénario).
5. **Seuils** : `evals/thresholds.json` fixe les minima par critère pour `smoke` (CI) et `full` (manuel). N'abaisse jamais un seuil pour faire passer la CI ; ouvre une fiche de tâche.
6. **Garde de la nuit** : chaque nuit, la CI lance `pnpm probe` puis `pnpm evals`. Les deux échouent sans clé, et `pnpm evals` échoue tant que la suite compte moins de `min_scenarios` fichiers YAML : une nuit verte mesure donc toujours quelque chose. `pnpm check` refuse qu'on retire ces deux lignes du job `nightly`. Le juge note chaque réponse écrite sur les neuf critères ; un critère que personne n'a pu noter fait échouer la suite.
7. **Coût** : un scénario = 2 à 3 appels LLM (cerveau, voix, juge). `smoke` reste à 30 scénarios au plus : les autres prennent `tier: full`.
8. **PR** : le rapport de `pnpm evals` (réponses, notes, moyennes) est collé dans la description.
