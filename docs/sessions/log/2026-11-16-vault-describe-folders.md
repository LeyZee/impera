# 2026-11-16 — vault-describe-folders (description du coffre limitée aux dossiers) — done
Fait : `vaultDescribeOrder` ne garde que les médias d'un dossier ; la requête du rattrapage horaire (`media.describe_vault_backlog`) suit la même règle ; ADR 0113 § 5 amendé (décision de Charles du 16/11) ; `LEFTOVER_AGE_MS` passe à 1 h (suite de la relecture Sécurité de #773). Tests : domaine (racine jamais prise, même tenue par un script), balayage à 1 h, intégration du rattrapage avec un média de racine inséré.
Pas fait : rien.
Décisions : la règle vit dans le domaine (`vaultDescribeOrder`) et est répétée en SQL dans le rattrapage pour qu'il ne relance pas un compte qui n'a plus rien à décrire.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires media ✓ ; `pnpm test:integration` non lancé (pas de Docker), CI.
