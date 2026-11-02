# CR-11 Mass DM : les médias déposés, envoyés aux listes de fans, jamais deux fois
Statut : blocked (capture Reveal : listes et Mass DM ; prix, listes et cadence à décider avec Charles) (ADR 0044 § 5, acceptée par Charles le 02/11/2026)
Phase : espaces (ADR 0044)
Dépend de : CR-06, CR-08, la capture Reveal
Branche : task/cr-11-mass-dm

## Objectif
Les médias déposés pour les Mass DM partent selon un plan à la semaine vers les listes de fans de Reveal, acceptés d'un geste, et un média n'est jamais renvoyé.

## Contexte à lire
`docs/adr/0044-content-drops-feed-and-mass-dm.md` (§ 5), ADR 0030 (§ 5, « vu par ce fan »), 0018, CR-08.

## À faire
- [ ] Avant le code : prix éventuel, choix des listes et cadence décidés avec Charles, écrits ici.
- [ ] Capacités du port : lire les listes de fans, envoyer un Mass DM ; d'abord dans `FakeReveal`.
- [ ] Plan à la semaine, acceptation d'un geste, clé d'idempotence par envoi, garde d'écriture.
- [ ] Un média n'est jamais renvoyé, et la base l'impose : `unique (media_asset_id)` sur la table des médias d'un Mass DM (pas un index partiel sur `media_assets`) ; la ligne d'envoi est insérée et le job mis en file par `graphile_worker.add_job(...)` dans la même transaction, avec `job_key` égal à la clé d'idempotence, jamais par `WorkerUtils` après le commit ; « vu par ce fan » appliqué à chaque destinataire ; un média déjà utilisé n'entre jamais dans un plan.
- [ ] Un Mass DM dont la réponse de Reveal se perd passe en ambre avec sa raison et n'est jamais relancé par le code.

## Critères d'acceptation
- Tests contre `FakeReveal` : un média jamais dans deux envois, double acceptation sans double envoi, garde fermée = rien ne part.

## Hors périmètre
Réutilisation des médias anciens (décision à part).

## Notes de session
