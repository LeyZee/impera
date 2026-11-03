# @impera/design-system

Le design system « Liquid Glass » d’Impera : tokens, pont Tailwind v4, classes de composants et aides d'animation. Consommé par `apps/web` et `apps/extension` (ADR 0015). Règles d'usage : `docs/design/README.md`.

## Contenu

| Export                                  | Fichier                     | Rôle                                                                                                                                |
| --------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@impera/design-system/tokens.css`     | `src/styles/tokens.css`     | Seule source des valeurs (`--nv-*`). Nuit par défaut, Jour sous `data-theme="light"`.                                               |
| `@impera/design-system/theme.css`      | `src/styles/theme.css`      | Pont Tailwind v4 (`@theme inline`) : utilitaires `bg-void`, `text-ink`, `rounded-lg`, `shadow-glass`…                               |
| `@impera/design-system/components.css` | `src/styles/components.css` | Classes `nv-*` sans framework.                                                                                                      |
| `@impera/design-system/base.css`       | `src/styles/base.css`       | Styles de page (`body`, sélection, focus). Jamais dans une page tierce.                                                             |
| `@impera/design-system/fonts.css`      | `src/styles/fonts.css`      | Geist, Geist Mono, Instrument Serif, Playfair Display italique (le nom), embarquées (Fontsource), sans appel tiers.             |
| `@impera/design-system/styles.css`     | `src/styles/index.css`      | Les quatre précédents (sauf `theme.css`), dans l'ordre.                                                                             |
| `@impera/design-system`                | `src/index.ts`              | `attachGlassLight`, `playLiquid`, `placeTabBarLens`, `placeSegmentThumb`, `collapseIsland`, `expandIsland`, `prefersReducedMotion`, `countUp` ; géométrie des graphiques `nv-chart` (`chartPoints`, `linePath`, `areaPath`, `niceTicks`, `nearestIndex`, dans `src/chart.ts`) et des pièces du Dashboard (`ringDash`, `funnelSteps`, `tipPlacement`, dans `src/dashboard.ts`). |

## Utilisation

`apps/web` (Tailwind v4) :

```css
@import '@impera/design-system/fonts.css';
@import 'tailwindcss';
@import '@impera/design-system/tokens.css';
@import '@impera/design-system/theme.css';
@import '@impera/design-system/base.css';
@import '@impera/design-system/components.css';
```

`apps/extension` (popup) :

```ts
import '@impera/design-system/styles.css';
```

Thème : rien à faire pour Nuit ; `document.documentElement.dataset.theme = 'light'` pour Jour.

Les aides d'animation ne gardent aucun état : le composant React garde l'onglet ou l'option sélectionnés et appelle l'aide dans un effet.

```tsx
useEffect(() => attachGlassLight(ref.current), []);
```

## Règles

- Une valeur visuelle (couleur, rayon, durée, courbe, taille de texte) n'existe que dans `tokens.css`. Les autres fichiers s'y réfèrent par `var(--nv-*)`.
- Changer un token de couleur : lancer `pnpm --filter @impera/design-system test` ; le test de contraste dit quelle paire casse.
- Pas de React ni de dépendance d'UI dans ce package (ADR 0015).
