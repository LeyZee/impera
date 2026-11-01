# 2026-10-29 — Recette design, API : âge contesté (SUIVI-04) — done
Recommandation acceptée par Charles le 29/10 00h22 : « Faut-il qu’un âge contesté (soupçon de mineur) ne puisse être confirmé que par le propriétaire ou un manager, avec une raison écrite ? Recommandation : oui, c’est la garde la plus grave et l’erreur coûte le compte. »
Fait : SUIVI-04, serveur et écran.
- Domaine (`fans/domain/flags.ts`) : `withHumanConfirmation` reçoit la portée de l'auteur ; sur un âge contesté, refus `age_dispute_forbidden` (403) hors propriétaire et manager actif, `age_dispute_reason_invalid` (400) sans raison écrite. `mayConfirmDisputedAge(scope)` dit qui peut. Un âge non contesté reste l'affaire d'un chatteur, comme avant.
- Infra (`flag-store.ts`) : une écriture d'un humain passe par `withTenantMember`, la portée vient de la base dans la transaction qui verrouille le fan (`self` par défaut, donc fail-closed pour un compte inconnu) ; une erreur levée n'écrit rien. La raison reste dans l'événement `fan_flag_set` (journal), avec l'auteur.
- Contrat : `FanFlagsViewSchema.mayConfirmDisputedAge` (GET et PUT), codes `AGE_DISPUTE_FORBIDDEN`, `AGE_DISPUTE_REASON_INVALID`.
- Écran (`screens/tracking/FanLimits.tsx`) : un âge contesté s'affiche en ambre (« Âge contesté depuis le … (soupçon de mineur) ») ; pour le propriétaire ou un manager, « Confirmer son âge » ouvre un champ « Pourquoi tu confirmes son âge » et « Oui, il est majeur » reste grisé tant qu'il est vide ; un chatteur lit « Seuls le propriétaire et les managers peuvent le confirmer », sans bouton. Les refus du serveur sont dits en clair.
Pas fait : rien sur ce constat.
Décisions : la raison est gardée dans l'événement existant (`fan_flag_set.reason`), pas dans une nouvelle table ; aucune migration.
Découvertes : le résumé replié des limites (« Aucune ») ne dit rien d'un âge contesté, et la section ne s'ouvre pas d'office dans ce cas (`isBlocking`) ; un membre d'équipe de portée `self` n'a pas accès aux limites (déjà noté EQ-13).
Candidats à suppression : aucun.
Vérifié : typecheck api et web ✓ ; unitaires `fans` (28) ✓ ; intégration `fan-flags`, `agent/fan-limits` (10) ✓ sur un Postgres 16 local (`NIRVANA_TEST_PG_URL`) ; web `screens/tracking` (107) ✓.
