# 2026-11-07 — Recette, suite du lot Bilan : AGT-11, MED-04, EXT-09, EXT-12

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, après la fusion de #626

## Fait

- AGT-11 : le panneau Ventes du Dashboard nomme une lecture arrêtée. `DashboardRevealSales.stopped` liste les flux de ses plateformes en `needs_reconnect` (message et dernière lecture), lus par `connectors.salesFeedStates` (l'état de Réglages › Ventes, jamais la clé). La carte d'une créatrice dans la liste garde ses totaux seuls ; l'affichage du panneau est à Extension.
- MED-04 : un média se lit par `node:http`, plus par `fetch` (`content-drops/infra/storage/node-get.ts`). L'undici de Node 22.23 (6.29) tombe sur une assertion quand le stockage ferme la connexion (`Connection: close`) pendant qu'un lecteur lent retient le corps, et l'erreur non rattrapée arrête l'API ou le worker. Reproduit sous 22.23 ; 22.22 (`.nvmrc`, image Docker) n'est pas touché, mais un poste à jour l'est. Les écritures restent par `fetch`.
- EXT-09 (partie créatrices) : une créatrice archivée n'est plus proposée pour marquer un post de Veille.
- EXT-12 : au démarrage, une erreur de l'API (500, 501…) dit « Impera a un problème » et non « ne répond pas », gardé pour une API muette ou un 502/503/504 du proxy. Captures validées par Charles (« ok captures EXT-12 »).

## Reste

- EXT-09, partie chatteurs : attend le mot de Charles (« ok veille-sans-chatteurs » ou « ok veille-chatteurs ») ; « sans » amende l'ADR 0060 dans la même PR.
- L'affichage de `stopped` sur le panneau Ventes (Extension).

## Découvertes

- `fetch` reste utilisé pour les écritures S3 ; si un stockage ferme aussi après un PUT lent, la même assertion pourrait revenir : à surveiller lors de la montée de Node.
