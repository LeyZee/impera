# Brief design : interface Impera

Statut : brief, design à produire avant la phase 4 (dashboard). Demande de Charles le 2026-10-16.

## Intention

Une interface **moderne, épurée, très belle**, inspirée du **Liquid Glass d'iOS 26 et 27** : surfaces translucides qui laissent passer et déforment légèrement ce qui est derrière, flou de fond, reflets et bords lumineux, profondeur par couches, animations fluides et physiques (ressort, inertie), typographie SF-like, grands rayons, contenu qui respire. Pas de dashboard « admin Bootstrap ». Pas de dégradés criards : la couleur vient des fonds, les surfaces restent neutres et vitrées.

Référence visuelle de départ : l'ancienne bannière violette du README (fond profond, halos flous, carte vitrée, bord lumineux), remplacée depuis par `brand/banner.svg`.

## Contraintes à respecter (non négociables)

1. **Clavier d'abord** dans l'inbox copilote : approuver, éditer, rejeter, suivant, précédent sans la souris, en moins de 5 s par draft (`message-flow.md`). Le verre ne doit jamais ralentir ce geste.
2. **Lisibilité** : le texte des conversations est lu des heures par jour. Contraste AA minimum sur toute surface vitrée (le verre + fond coloré est le piège classique : prévoir un voile d'assombrissement sous le texte).
3. **Mode sombre et mode clair**, sombre par défaut (usage le soir).
4. **Performance** : `backdrop-filter` coûte cher sur les listes longues ; le verre va sur les surfaces de chrome (barres, panneaux, cartes flottantes), pas sur chaque ligne de liste. Animations avec `prefers-reduced-motion` respecté.
5. **Mobile / PWA** (phase 5) : la même langue visuelle sur le téléphone de Messa, avec des composants qui tiennent au pouce.
6. **Accessibilité** : focus visible sur verre, tailles de cible ≥ 44 px, pas d'information portée par la couleur seule.
7. **Pile imposée** : Tailwind v4 (tokens dans `@theme`), shadcn/ui comme base de composants (restylés), React 19. Pas de bibliothèque d'UI supplémentaire sans ADR.

## Livrables attendus (tâche D-01)

- **Tokens** : couleurs (fonds profonds, halos, surfaces vitrées à 3 niveaux d'opacité, texte, accents sémantiques succès/alerte/danger/vente), rayons, ombres et bords lumineux, flous, typographie (échelle), espacements, durées et courbes d'animation. Exprimés en CSS `@theme` Tailwind v4 dans `apps/web/src/styles/tokens.css`.
- **Composants** : barre latérale vitrée, carte de conversation, bulle de message (fan / Messa / brouillon), panneau de draft avec brief et traces, badge d'état, interrupteur (kill switch), toast de notification, fiche fan, graphiques de métriques (sobres).
- **Écrans** : inbox copilote, conversation, fan, supervision, persona (phase 5), écran mobile de notification de vente.
- **Guide** : `docs/design/README.md` expliquant les règles du verre (où oui, où non), les états (hover, focus, actif, désactivé) et les animations.

## Questions ouvertes

Tranchées par Charles le 2026-10-16 : voir `docs/design/README.md` (identité propre, néon rouge sur nuit, en code).

- Le design system **IMPERA** (tokens `colors_and_type.css`, utilisé par OnlyScript) existe. Impera le reprend-il (cohérence agence) ou crée-t-il sa propre identité Liquid Glass ? Proposition : identité propre pour Impera, avec la typographie et les accents sémantiques alignés sur IMPERA si possible.
- Nom et logo : « Impera » est le nom de code ; le logo du banner (deux vagues) est un placeholder.
- Outil : maquettes Figma, ou directement en code dans `apps/web` avec un Storybook léger ? Proposition : en code, c'est ce que les sessions Opus savent faire et ça évite la double maintenance.
