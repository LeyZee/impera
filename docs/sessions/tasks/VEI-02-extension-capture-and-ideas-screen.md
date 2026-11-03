# VEI-02 Capture passive dans l'extension, page « Veille » et écran « Idées du jour »
Statut : todo
Phase : veille (ADR 0060)
Dépend de : VEI-01
Branche : task/vei-02-extension-capture
Propriétaire : Extension (apps/extension, apps/web)

## Objectif
Un humain regarde Instagram sur ordinateur et l'extension relève ce qu'il voit ; l'agence colle des liens, puis valide, corrige ou refuse les idées du jour.

## Contexte à lire
ADR 0060 § 1, § 2 (source 6) et § 5, ADR 0056 § 3 (rendu du carton), `/mnt/project-files/veille-instagram/variantes-navigateur.md` (hors dépôt).

## À faire
- [ ] Permission `https://www.instagram.com/*` ajoutée à l'extension ; aucune ressource accessible depuis la page (`web_accessible_resources` vide pour Instagram).
- [ ] Script de contenu dans le **monde isolé**, lecture par `MutationObserver` seulement : jamais de remplacement de `fetch` ni d'injection dans la page, jamais de défilement, de clic ni de requête.
- [ ] Relevé par post affiché : lien, nom du compte, vues, j'aime et commentaires quand ils sont affichés, légende et hashtags, nom du son, temps passé. Rien sur `/direct/`, les stories ou un compte privé.
- [ ] « Veille » s'active à la main, se montre (badge), s'arrête seule à 45 minutes ou en quittant Instagram ; geste « pour <créatrice> » qui marque un post.
- [ ] Échec de lecture (page changée) : ambre dans l'extension, jamais de rechargement.
- [ ] Envoi par lots à la route de VEI-01, idempotent.
- [ ] apps/web : page « Veille » (coller un lien, une ligne, un format, la créatrice), écran « Idées du jour » (une carte par idée rendue comme un carton ; valider, corriger, refuser avec motif).

## Critères d'acceptation
- Tests du lecteur sur des pages **fabriquées** (aucune page enregistrée sur un vrai compte, ADR 0010).
- Test qui vérifie que le script de contenu n'appelle ni `fetch`, ni `scroll`, ni `click` sur la page.
- Captures jour et nuit, ordinateur et téléphone pour l'écran web.

## Hors périmètre
Le relevé sur téléphone (n'existe pas : coller le lien). La génération des idées (VEI-03).

## Notes de session
