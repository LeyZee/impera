# 2026-11-27 — CI : les jobs lourds ne tournent plus sur les brouillons — done
Fait : `.github/workflows/ci.yml` saute les tests (unité, intégration en quatre, e2e), l'audit, le build et les images sur une PR en brouillon ; le check statique et gitleaks y restent. Une PR qui passe « prête » les lance aussitôt (`ready_for_review`). Le job requis « Tests (unit + integration) » échoue exprès sur un brouillon (réserve de Sécurité : un vert de brouillon resterait le dernier résultat sur le même commit pendant que le passage « prête » démarre), et exige le succès des parts partout ailleurs. Guide `docs/conventions/git-and-pr.md` mis à jour.
Pas fait : runner auto-hébergé (après l'ouverture du 1er, machine séparée de la prod, seulement en dépôt privé).
Décisions : passage du dépôt en privé choisi par Charles (fil Sécurité) ; ce lot réduit le coût des minutes de CI qui en découle.
Découvertes : rien.
Candidats à suppression : rien.
Vérifié : prettier et check-repo sur les fichiers touchés ; le comportement réel se vérifie sur cette PR (brouillon puis prête).
