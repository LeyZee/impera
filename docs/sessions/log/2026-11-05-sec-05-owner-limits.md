# 2026-11-05 — SEC-05 : les limites des ventes Reveal ne comptent que le propriétaire

Fait : la clé, le webhook, l'import et la vérification de `/v1/settings/sales-feeds` comptaient leur limite par adresse, avant la garde ; des appels anonymes ou d'un chatteur depuis la même adresse épuisaient le quota du propriétaire (recette 05/11, SEC-05). La limite est maintenant comptée après la garde, par compte et par adresse (`createRateLimit`, clé `sales-feed-<geste>:<compte>:<ip>`) : un appel refusé (401, 403) ne la touche plus, et le dépassement répond le même 429 `rate_limited` avec `Retry-After`.
Pas fait : rien.
Décisions : mêmes plafonds qu’avant, chaque geste son compteur (clé 10, webhook 10, import 10, vérification 3 par minute).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `sales-feed-check.integration.test.ts` (huit appels anonymes ou d'un chatteur ne coûtent rien, le quatrième appel du propriétaire est refusé), suites `sales-feed*`.
