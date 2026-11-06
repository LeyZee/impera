# VEI-02 Capture passive dans l'extension, page « Veille » et écran « Idées du jour »
Statut : done
Phase : veille (ADR 0060)
Dépend de : VEI-01 (dont la liaison par personne), composant de carton des lots SC
Branche : task/vei-02-extension-capture
Propriétaire : Extension (apps/extension, apps/web)

## Objectif
Un humain regarde Instagram sur ordinateur et l'extension relève ce qu'il voit ; l'agence colle des liens, puis valide, corrige ou refuse les idées du jour.

## Contexte à lire
ADR 0060 § 1, § 2 (source 6) et § 5, ADR 0056 § 3 (rendu du carton), `/mnt/project-files/veille-instagram/variantes-navigateur.md` (hors dépôt).

## À faire
- [x] Manifeste : `optional_host_permissions` pour `https://www.instagram.com/*`, demandée au premier clic sur « Veille » ; script de contenu `matches` Instagram avec `exclude_matches` sur `/direct/*`, `/stories/*`, `/accounts/*` ; monde isolé (jamais `world: 'MAIN'`), `allFrames: false` ; aucune `web_accessible_resources` pour Instagram. README de l'extension mis à jour.
- [x] Lecture passive seulement : `MutationObserver` et `IntersectionObserver` (post à l'écran, temps passé) ; navigation lue par `wxt:locationchange` ; jamais de remplacement de `fetch`, d'injection de nœud ou de style dans la page, de défilement, de clic ni de requête.
- [x] Pages relevées : `/reels/`, `/reel/…`, `/p/…`, `/explore/` et profils sans marqueur « privé » ; jamais le fil d'accueil `/`.
- [x] Relevé assemblé par code court du post : compte, légende telle qu'affichée (jamais de clic sur « plus »), nom et identifiant du son (`/reels/audio/<id>/`), j'aime et commentaires si affichés, vues lues sur l'onglet Reels d'un profil (seul endroit où elles s'affichent) ; une valeur absente vaut `null`, jamais 0 ; nombres abrégés et localisés lus correctement (« 12,3 k », « 1,2 M », espace insécable).
- [x] « Veille » s'active à la main ; badge par onglet ; arrêt à 45 minutes (`chrome.alarms`, départ dans `chrome.storage.session`) ou en quittant Instagram (`tabs.onUpdated`/`onRemoved`, `pagehide`).
- [x] Au marquage d'un post : au plus quatre captures de l'onglet visible (`tabs.captureVisibleTab`, depuis le background, jamais de lecture du `<video>` ni de canvas dans la page), envoyées à la vision, jamais écrites sur disque ni en base ; durée lue sur l'élément vidéo affiché ; la vision rend accroche, angles, texte à l'écran, montage estimé.
- [x] Geste « pour <créatrice> » sans rien injecter dans la page : popup (« Marquer le post à l'écran pour… »), menu contextuel sur le lien du post ou raccourci clavier.
- [x] Ambre : sur une page relevée, des liens de posts présents mais aucun champ lu pendant N secondes ; jamais de rechargement.
- [x] Envoi par lots depuis le background (jamais depuis le script de contenu), avec la liaison par personne de VEI-01 et l'identifiant de session de veille.
- [x] apps/web : page « Veille » (coller un lien, une ligne, un format, la créatrice), écran « Idées du jour » (une carte par idée rendue avec le composant de carton des lots SC, réutilisé et non refait ; valider, corriger, refuser avec motif).

## Critères d'acceptation
- Tests du lecteur sur des pages **fabriquées** (aucune page enregistrée sur un vrai compte, ADR 0010).
- Test du manifeste construit : pas de `web_accessible_resources` sur Instagram, pas de monde `MAIN`.
- Vérification statique du bundle du script de contenu : ni `fetch`, `XMLHttpRequest`, `sendBeacon`, `scrollTo`/`scrollBy`/`scrollIntoView`, `.click(`, `dispatchEvent`, `window.open`, `location.assign`/`replace`.
- Captures jour et nuit, ordinateur et téléphone pour l'écran web.

## Hors périmètre
Le relevé sur téléphone (n'existe pas : coller le lien). La génération des idées (VEI-03).

## Notes de session
- 06/11/2026, lot a (web, Extension) : « Idées du jour » est une fiche de Créatrices (`?onglet=idees`), ouverte au propriétaire et aux managers actifs à côté de l'agenda : une carte par idée avec la tendance citée, valider tel quel, corriger sur place (seuls les champs changés partent), refuser avec un motif facultatif ; la garde du serveur (422) se dit telle quelle. « Coller un lien » vit dans cette fiche, pour la créatrice affichée. « Relier l'extension » est un panneau de Sécurité (Réglages pour le propriétaire, Moi pour un manager) : trois navigateurs au plus, le code montré une seule fois, délier après confirmation. Pas de « composant de carton » : un carton (ADR 0056 § 3) est une image rendue par le serveur pour une étape de script, rien à réutiliser pour une idée ; la carte reprend les styles de l'agenda. Reste le lot b : l'extension (manifeste, lecteur passif, Veille, marquage, envoi par lots) et la case « Relier » de sa popup qui prend le code.
- 06/11/2026, lot b (apps/extension, Extension) : fait, avec trois écarts à la lettre de la fiche, pour mieux tenir son esprit. (1) Le lecteur n'est pas un script de contenu du manifeste : c'est un script « unlisted » enregistré à l'exécution (`chrome.scripting.registerContentScripts`) une fois Instagram autorisé ; un script du manifeste aurait demandé l'accès à Instagram dès l'installation, et le wrapper des scripts de contenu de WXT fait `postMessage` et `dispatchEvent` sur le document, que la page entend. (2) La navigation est lue en relisant `location.pathname` toutes les 500 ms, pas par `wxt:locationchange`, qui passe par un `dispatchEvent`. (3) Le menu contextuel marque le post du lien sans captures (il n'est pas forcément à l'écran) ; la popup et Alt+Maj+M marquent avec captures. La carte « Veille Instagram » de la popup n'est montrée qu'au propriétaire et aux managers, sur un onglet Instagram. Le code de liaison est gardé dans `chrome.storage.local`, lu par le service worker seul : cela demande l'amendement de l'ADR 0066 soumis à Charles (« ok phrases 0066 »), sinon il passe en `chrome.storage.session` (à recoller à chaque démarrage du navigateur).
