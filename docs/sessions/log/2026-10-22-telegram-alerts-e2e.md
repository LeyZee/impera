# 2026-10-22 — P3-07 : alertes Telegram vérifiées de bout en bout — done
Fait : test d'intégration `apps/api/src/__tests__/telegram-alerts.integration.test.ts` qui relie le vrai module `conversations` au vrai module `telegram` (seul Telegram est joué par FakeTelegram) : remise à l'humain puis prise en main (« Pris en main par… »), remise puis retour à l'agent (« Rendu à l'agent par… »), échec d'envoi définitif (une alerte, sans le code de la plateforme ni la bulle), fermeture de l'Automatique (sans la voix). Vérifie aussi qu'aucun texte de fan ne part.
Pas fait : rien.
Décisions : un seul groupe pour tout le fichier, comme en production : la relecture de fenêtre du scan redonnerait les alertes des tests précédents à un groupe neuf.
Découvertes : aucune ; les quatre chemins marchent sur `main` après #114.
Candidats à suppression : aucun.
Vérifié : `pnpm check` ✓ ; toute l'intégration de l'API (23 fichiers, 118 tests) ✓ sur un Postgres 16 local (`NIRVANA_TEST_PG_URL`).
