# VEI-02 Capture passive dans l'extension, page « Veille » et écran « Idées du jour »
Statut : todo
Phase : veille (ADR 0060)
Dépend de : VEI-01 (dont la liaison par personne), composant de carton des lots SC
Branche : task/vei-02-extension-capture
Propriétaire : Extension (apps/extension, apps/web)

## Objectif
Un humain regarde Instagram sur ordinateur et l'extension relève ce qu'il voit ; l'agence colle des liens, puis valide, corrige ou refuse les idées du jour.

## Contexte à lire
ADR 0060 § 1, § 2 (source 6) et § 5, ADR 0056 § 3 (rendu du carton), `/mnt/project-files/veille-instagram/variantes-navigateur.md` (hors dépôt).

## À faire
- [ ] Manifeste : `optional_host_permissions` pour `https://www.instagram.com/*`, demandée au premier clic sur « Veille » ; script de contenu `matches` Instagram avec `exclude_matches` sur `/direct/*`, `/stories/*`, `/accounts/*` ; monde isolé (jamais `world: 'MAIN'`), `allFrames: false` ; aucune `web_accessible_resources` pour Instagram. README de l'extension mis à jour.
- [ ] Lecture passive seulement : `MutationObserver` et `IntersectionObserver` (post à l'écran, temps passé) ; navigation lue par `wxt:locationchange` ; jamais de remplacement de `fetch`, d'injection de nœud ou de style dans la page, de défilement, de clic ni de requête.
- [ ] Pages relevées : `/reels/`, `/reel/…`, `/p/…`, `/explore/` et profils sans marqueur « privé » ; jamais le fil d'accueil `/`.
- [ ] Relevé assemblé par code court du post : compte, légende telle qu'affichée (jamais de clic sur « plus »), nom et identifiant du son (`/reels/audio/<id>/`), j'aime et commentaires si affichés, vues lues sur l'onglet Reels d'un profil (seul endroit où elles s'affichent) ; une valeur absente vaut `null`, jamais 0 ; nombres abrégés et localisés lus correctement (« 12,3 k », « 1,2 M », espace insécable).
- [ ] « Veille » s'active à la main ; badge par onglet ; arrêt à 45 minutes (`chrome.alarms`, départ dans `chrome.storage.session`) ou en quittant Instagram (`tabs.onUpdated`/`onRemoved`, `pagehide`).
- [ ] Au marquage d'un post : au plus quatre captures de l'onglet visible (`tabs.captureVisibleTab`, depuis le background, jamais de lecture du `<video>` ni de canvas dans la page), envoyées à la vision, jamais écrites sur disque ni en base ; durée lue sur l'élément vidéo affiché ; la vision rend accroche, angles, texte à l'écran, montage estimé.
- [ ] Geste « pour <créatrice> » sans rien injecter dans la page : popup (« Marquer le post à l'écran pour… »), menu contextuel sur le lien du post ou raccourci clavier.
- [ ] Ambre : sur une page relevée, des liens de posts présents mais aucun champ lu pendant N secondes ; jamais de rechargement.
- [ ] Envoi par lots depuis le background (jamais depuis le script de contenu), avec la liaison par personne de VEI-01 et l'identifiant de session de veille.
- [ ] apps/web : page « Veille » (coller un lien, une ligne, un format, la créatrice), écran « Idées du jour » (une carte par idée rendue avec le composant de carton des lots SC, réutilisé et non refait ; valider, corriger, refuser avec motif).

## Critères d'acceptation
- Tests du lecteur sur des pages **fabriquées** (aucune page enregistrée sur un vrai compte, ADR 0010).
- Test du manifeste construit : pas de `web_accessible_resources` sur Instagram, pas de monde `MAIN`.
- Vérification statique du bundle du script de contenu : ni `fetch`, `XMLHttpRequest`, `sendBeacon`, `scrollTo`/`scrollBy`/`scrollIntoView`, `.click(`, `dispatchEvent`, `window.open`, `location.assign`/`replace`.
- Captures jour et nuit, ordinateur et téléphone pour l'écran web.

## Hors périmètre
Le relevé sur téléphone (n'existe pas : coller le lien). La génération des idées (VEI-03).

## Notes de session
