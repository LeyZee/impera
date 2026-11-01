# 2026-10-27 — OPS-02 Sauvegarde quotidienne, lot 5 : vérification de la copie des clés — done
Fait : `pnpm ops:check-keys` (`apps/api/src/scripts/ops-check-keys.ts`, construit dans l'image) : demande sans écho la copie gardée de `SESSION_ENCRYPTION_KEYS` et `CREDENTIALS_ENCRYPTION_KEYS`, ouvre en mémoire chaque session de plateforme, clé de service IA et jeton de bot Telegram, sur un pool en `default_transaction_read_only`, et nomme ce qui ne s'ouvre pas (compte, service, bot), jamais un secret. `key-check.ts` à la racine de l'API ; `checkProviderKeys` et `checkTelegramTokens` exportés par les index de leurs modules, sur leurs lectures existantes. `deploy.md` § 4.2, `restore.md` § C, `rotate-secrets.md`, fiche OPS-02.
Pas fait : la saisie de l'essai (EQ-17, lot 4, attend l'accord de Bilan), le premier essai réel.
Décisions : la commande lit la base de production depuis le terminal de l'API, avec les clés tapées : c'est la copie qu'on teste, pas celles du serveur.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : intégration contre Postgres 16 (bonne copie : tout s'ouvre ; copie périmée : compte, service et bot nommés, aucun secret dans le rapport ; écriture refusée par la base, SQLSTATE 25006) ; `pnpm check`.
