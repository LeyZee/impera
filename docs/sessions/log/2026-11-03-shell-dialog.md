# 2026-11-03 — Dialog partagé monté dans shell/ — done
Fait : `screens/team/Dialog.tsx` déplacé en `shell/Dialog.tsx` (git mv) ; ses styles (fond, verre, croix, en-tête, pied, animations) sortent de `team.css` vers `shell/dialog.css`, importé par le composant ; les 28 écrans qui l'utilisaient importent `@/shell/Dialog` ; le test des cibles tactiles lit `.tm-close` et `.tm-scrim` dans `shell/dialog.css`.
Pas fait : rien.
Décisions : les classes gardent leur préfixe `tm-` pour qu'aucun écran ni surcharge (`pay.css`, `billing.css`) ne change ; `team.css` garde ce qui est propre à l'équipe (fiche, étapes, champs).
Découvertes : rien ; l’agenda (#504, fusionné entre-temps) importe aussi `@/shell/Dialog`.
Candidats à suppression : rien.
Vérifié : `apps/web` 1375/1375 ✓, `pnpm check` ✓.
