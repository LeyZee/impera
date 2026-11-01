## Fiche
<!-- ID de la fiche de tâche, ex. P0-03. Une PR = une fiche. -->

## Avant / après
<!-- Deux paragraphes : ce qu'un lecteur voyait avant, ce qu'il voit après. -->

## Comment
<!-- Court. Les choix non évidents, les ADR proposées. -->

## Vérifications
- [ ] `pnpm check` et `pnpm test` verts en local
- [ ] Tests ajoutés pour le comportement nouveau (unit / intégration / contrat / éval selon le cas)
- [ ] Docs mises à jour (README du module, architecture, glossaire, ADR si décision)
- [ ] Fiche de tâche mise à jour et entrée de journal dans `docs/sessions/log/`
- [ ] mes fichiers de `.scratch/` supprimés, `git status` propre, aucun fichier parasite
- [ ] Aucun secret, aucune donnée réelle (fan, persona, session)
- [ ] Sécurité : entrées validées, `withTenant` sur chaque accès base, contenu fan traité comme non fiable
