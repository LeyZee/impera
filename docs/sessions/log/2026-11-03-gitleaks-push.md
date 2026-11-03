# 2026-11-03 — Scan de secrets au push et version figée en CI — done
Fait : `gitleaks` tournait déjà avant chaque commit et en CI. Il tourne maintenant aussi avant chaque push (`scripts/gitleaks-hook.mjs push`) sur tout commit local qu'aucune branche d'`origin` ne porte encore, ce qui rattrape un commit fait là où le hook de commit n'a pas tourné. Les deux hooks passent par ce script : sans le binaire, ils s'arrêtent et disent comment l'installer, au lieu d'un « command not found ». En CI, `gitleaks-action` est figée sur le commit de v3.0.0 (30/05/2026) et `gitleaks` sur 8.24.2, la version des hooks, au lieu d'une étiquette mobile.
Pas fait : rien sur l'historique, déjà propre (1 121 commits scannés, aucune fuite).
Décisions : la quarantaine de 14 jours vaut aussi pour une action GitHub et pour le binaire qu'elle télécharge.
Découvertes : les autres actions de `ci.yml` (`checkout`, `setup-node`, `pnpm/action-setup`) suivent encore une étiquette majeure.
Candidats à suppression : aucun.
Vérifié : `pnpm test:scripts` (dont un dépôt jetable qui porte une clé inventée : push refusé) ; `gitleaks git` sur tout l'historique ; pnpm check ✓.
