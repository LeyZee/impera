# 2026-11-03 — Logo Impera partout (ADR 0062) — done

Fait : le logo v7 (buste de marbre couronné de laurier, en Liquid Glass, laurier néon) remplace l'ancien symbole partout où il est servi.

- `brand/` : lockups Nuit, Jour et mono, symboles Nuit, Jour et mono, `favicon.svg`, `banner.svg`, et un nouveau `impera-mark-small.svg` (silhouette pleine, lisible de 24 à 47 px). Règle des tailles dans `brand/README.md`.
- PWA (`apps/web/public`) : favicon, icônes 192, 512, maskable, apple-touch, badge, `impera-mark.svg` (rail et écrans publics). Le halo CSS du rail et de `PublicBrand` est retiré : le laurier est la seule lumière. `VERSION` de `sw.js` passe à v4 pour que les téléphones reprennent les icônes.
- Extension : icônes 16, 32, 48, 128 et `mark.svg`.
- `docs/design/images` : les six images refaites depuis le serveur de dev avec des données inventées. La planche du logo passe en `marque.jpg` (le PNG dépassait 512 000 octets).
- README racine, `docs/design/README.md`, `apps/extension/README.md` : description du logo à jour.

Décisions : aucune nouvelle (ADR 0062 acceptée, logo v7 validé par Charles).

Le dépôt GitHub s'appelle maintenant `LeyZee/impera` (l'ancienne URL redirige) : `docs/runbooks/deploy.md` cite la nouvelle source Coolify ; la ligne historique de `docs/roadmap.md` reste.

Pas fait : le renommage du dossier local, geste de Charles avec Claude Code fermé. Sur iPhone, l'icône de l'écran d'accueil ne change qu'en réinstallant la PWA.

Découvertes : aucune.
