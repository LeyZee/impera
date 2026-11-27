# 2026-11-21 — SEC-16, quatrième réduction : conservation des dépôts de contenu (ADR 0087, lot c)
Fait : la tâche horaire `content_drops.erase_originals` n'écrit plus sous le rôle de service. Ses quatre lectures, qui parcourent toutes les créatrices, y restent ; l'effacement d'un original, celui d'une vignette, les annonces et la ligne d'audit passent dans la créatrice du média, sous le rôle applicatif (`withTenantJob`, tâche `drop_media`), avec un filtre explicite sur la créatrice en plus des politiques. Aucune politique nouvelle, aucune migration. Plafond des dépôts de contenu 18 → 14.
Pas fait : la réception des fichiers et les demandes du même module ; les deux rattrapages horaires.
Décisions : aucune nouvelle ; application de l'avenant du 20/11 à l'ADR 0087. Prévenu : le fil Médias, propriétaire du module, qui relit.
Découvertes : une porte commune pour parcourir les créatrices ferait baisser les lectures restantes de plusieurs modules.
Candidats à suppression : aucun.
Vérifié : `script-drops.integration.test.ts` ✓ (un original nommé avec une autre créatrice n'est ni effacé ni annoncé ; un original encore tenu par un script reste même demandé par son nom ; dans sa créatrice il part une fois et se dit une fois) ; plafond ✓ ; tests unitaires du module ✓. `content-drop-uploads` exige un stockage S3 : la CI le couvre.
