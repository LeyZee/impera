# apps/web

Le dashboard de supervision (Vite, React 19, TanStack Router + Query, Tailwind v4, shadcn/ui), installable en PWA (phase 5, Web Push).

Écrans par phase : connexion (P0) · liste des conversations (P0, brute) · inbox copilote clavier (P4 : approuver `a`, éditer `e`, rejeter `r`, suivant `j`/`k`) · conversation avec journal et traces (P4) · fiche fan et faits (P4) · supervision : interrupteurs, sessions, métriques (P4) · persona (P5) · catalogue et offres (P6).

Règles : les types viennent de `@impera/contracts` ; aucun appel direct à la base ; l'état serveur passe par TanStack Query ; temps réel par SSE (`/v1/events`). Le design « Liquid Glass » (iOS 26/27, néon rouge sur nuit) vient de `@impera/design-system` : tokens, pont Tailwind v4 et classes `nv-*` (ADR 0015) ; règles dans `docs/design/README.md`, fiche D-01. Les composants shadcn/ui restylés vivent ici.

## Application installée (CR-01, ADR 0042 § 8)

- `public/manifest.webmanifest` et `public/icons/` : nom, couleurs (`--nv-void`) et icônes de l'écran d'accueil. La barre du navigateur suit Nuit ou Jour (`THEME_COLORS` dans `src/shell/appearance.ts`, même valeur dans `public/appearance.js`).
- `public/sw.js`, écrit à la main, sans dépendance : garde la page et les fichiers hachés de `/assets/` pour ouvrir l'app sans réseau ; ne touche jamais `/v1/`. Changer ce fichier, c'est changer `VERSION`. nginx le sert en `no-cache` (vérifié en CI).
- `src/pwa/` : enregistrement (production seulement), proposition « Mettre à jour » (jamais de rechargement imposé en plein shift), carte « Impera sur ton écran d'accueil » sur téléphone (trois « Plus tard » et elle ne revient plus), guide `/aide/installer`, et `forgetDevice()` à chaque déconnexion ou 401.
- Notifications push : `src/pwa/push.ts` (état de l'appareil, activation au seul geste de la personne, clé du serveur lue avant la demande, réabonnement si elle change, appareil oublié côté serveur avant la déconnexion), réception dans `sw.js` (`push`, `notificationclick` : texte borné, lien interne seulement), écran `/notifications` depuis le menu du compte. Les règles de ce qui sonne vivent sur le serveur (module `notifications`).
