# 2026-11-05 — D-03 : peaufiner les écrans du chatteur
Fait :
- lot a : Aujourd'hui rassemble ce qui attend le chatteur dans un seul « À faire » (`TodoCard`, `fileToDos`, `reportToDos`) et mène à Suivi avec le nombre à traiter ;
- lot b : Suivi garde le rouge pour les urgences ; l'état « brouillon » passe en neutre ; pseudo et non-lus d'abord ;
- lot c : bulles envoyées en mauve désaturé, brouillon en contour pointillé neutre, « Automatique » sous les messages de l'agent, fiche du fan dans l'en-tête de la conversation ;
- lot d : Moi › Préférences, « Plus » retiré de la barre du téléphone quand il n'apporte rien ; « Demander un congé » dans « Mes congés » ; en-tête de Commissions allégé ; Dossier aligné.

Pas fait : captures après et validation de Charles ; relecture Extension.

Décisions :
- Q1 (Charles) : aucun message envoyé en rouge ; mauve désaturé préféré au gris chaud sur captures comparées ; jetons `--nv-bubble-sent` et `--nv-fill-soft` ajoutés au design system, contraste AA testé ;
- Q2 (Charles) : le contenu de « Plus » va dans Moi ; la règle vit dans `railOf` (`phoneMenu`), sans toucher la table des menus de `packages/contracts` (ADR 0066) ;
- la créatrice, dont les quatre onglets tiennent aussi sur la barre, profite de la même page Préférences.

Découvertes :
- aucune.

Vérifié :
- `pnpm check` ;
- `vitest` d'apps/web (144 fichiers) ;
- captures avant et après sur un banc à fixtures hors dépôt (`.scratch/`).
