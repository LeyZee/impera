# 2026-10-25 — D-01 Refonte : images du guide — done
Fait : les images du guide (`docs/design/images/`) sont refaites depuis le CRM refait : Dashboard en Nuit et en Jour, le lecteur de Suivi avec les limites du fan et un brouillon, et trois écrans sur téléphone (Dashboard, Suivi, Entraîner), avec des données inventées servies par Playwright. La palette et la typographie sont rendues de nouveau depuis le package : les valeurs sont lues dans `tokens.css` (elles avaient changé depuis le 19/10 : fonds, encre, néon plein, focus, et les nouveaux `plate`, `select`, `select-strong`), les montants sont en euros et les chiffres en Geist tabulaire. Les deux planches de composants d'avant la refonte (`composants-nuit.jpg`, `composants-jour.jpg`) sont retirées : elles montraient tout en verre, le néon partout et des dollars. Le README racine montre le Dashboard et décrit la navigation actuelle (validation dans Suivi).
Pas fait : le logo (`marque.png`) ne change pas, il est intouchable.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, images relues une à une.
