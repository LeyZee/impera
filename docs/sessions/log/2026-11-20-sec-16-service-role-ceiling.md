# 2026-11-20 — SEC-16, test de plafond du rôle de service (ADR 0087, lot b) — en cours
Fait : `service-role-ceiling.test.ts` compte par module les appels `withAdmin(` et les requêtes directes sur la connexion de service, et exige les nombres de `service-role-ceiling.ts` (265 au total le 20/11/2026) ; un ajout casse le test, un retrait aussi tant que le plafond n'est pas baissé ; fiche SEC-16.
Pas fait : le plan de réduction (lot c) avec le fil Bilan, puis la réduction module par module.
Décisions : aucune nouvelle ; c'est le lot b de l'ADR 0087, décidé le 14/11 et jamais écrit.
Découvertes : le nombre d'accès était passé de 198 à 230 appels `withAdmin` entre le 14/11 et le 20/11 (mesure du fil « Juger la santé du code ») ; 28 requêtes de plus partent directement sur la connexion de service, sans passer par `withAdmin`.
Candidats à suppression : aucun.
Vérifié : test de plafond ✓ ; un appel ajouté à la main dans un module le fait échouer ✓ (retiré ensuite).
