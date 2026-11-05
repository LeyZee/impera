# 2026-11-05 — Fenêtres : le verre ne défile plus, l'erreur se montre ; l'encart sans trait — done

Fait : le verre d'une fenêtre (`shell/Dialog.tsx`, et `AddMemberPanel.tsx` qui la recopie) ne défile plus ; c'est son contenu qui défile dedans (`.tm-dialog__scroll`), si bien que le liseré reste au bord au lieu de couper le formulaire en travers. Quand un message d'erreur (`role="alert"`) apparaît hors de la partie visible, la fenêtre défile juste assez pour le montrer (`shell/reveal.ts`), sans animation si le mouvement est réduit. Le relevé de Paie (`.py-read`), qui contournait déjà le défaut, garde son défilement à lui.
L'encart d'avertissement partagé (`.rp-notice`, huit écrans) perd son trait coloré à gauche (Charles : jamais de barre sur le côté) ; il se lit par sa teinte, son titre et un liseré tout autour, teinté de son ton.
Pas fait : rien.
Décisions : le défilement va au bord le plus proche avec 16 px de marge, jamais au-delà du haut du message ; seul le premier message apparu compte.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `reveal.test.tsx` (6), 1 467 tests d'apps/web verts ; typecheck et lint d'apps/web ; captures avant/après (fenêtre et encart), Nuit et Jour, 1440×900 et téléphone, hors dépôt (`espaces/fenetres-verre-erreur/`).
