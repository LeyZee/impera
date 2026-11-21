# 2026-11-16 — Vitrine : la forge d'un passage de rang

- **Tâche** : PROPOSED-trophy-case (suite). Charles a demandé des animations et des sons pour chaque passage de rang (validation de vitrine-rang-b-2, 16/11).
- **Fait** :
  - `RewardReveal` prend une prop `forge` (le rang), posée par `revealWordsOf` pour les objets `level:N`. Déroulé : médaillon froid, braises aspirées vers le cœur, éclair à 0,9 s, feu qui monte, puis la lumière, les éclats et les mots habituels. Tout est réglé en 2,5 s.
  - Son « forge », de la famille « gagné » : `forge-sound.ts`, synthétisé dans le navigateur, 2,4 s. Il se coupe avec « Sons » et ne joue jamais dans un onglet caché.
  - Pour toutes les révélations : titre sans capitales, scène jusqu'à 340 px sur ordinateur, et « réduire les animations » donne un fondu de 150 ms vers l'image finale.
- **Tests** : `RewardReveal.test.tsx` (forge, pas de forge, son), `reveal-words.test.tsx`, `forge.css.test.ts` (durées, éclair, transform et opacity seulement, réduire les animations).
- **Captures** : recette/2026-11-16/vitrine-forge-2 (7 fichiers dont 3 vidéos avec le son). Validé par Charles le 16/11.
- **Reste** : les barres de progression (de la dernière valeur vue à la valeur actuelle), les survols et le son « rempli » ; la phrase avec le montant (Chiffres) ; la règle « plusieurs cérémonies dues : la plus haute seule » (Chiffres, `RewardRevealGate`).
