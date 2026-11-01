# Module `team`

**Rôle.** Équipe › Membres (EQ-01, ADR 0023, ADR 0024) : les chatteurs et les managers, leur pays, leur statut, leurs créatrices, leur commission et leur rôle datés, les préréglages de commission et les notes internes.

**Peut dépendre de.** aucun module métier (feuille). Deux ports, branchés par le composition root : les créatrices qui existent, venues du module `persona` (`CreatorRoster`), le lien en cours de chaque membre, lu dans la table des liens d'EQ-10 (`InvitationLinkDirectory`), et le recalcul d'une quinzaine par la paie (`enqueuePayRecalculation`, du module `payroll`).

**Tables possédées.** `team_members`, `team_member_notes`, `commission_presets`, `member_commission_rates`, `member_roles` (migration 0034). Toutes passent par `withMember` : la base décide de ce que lit chaque scope (`owner`, `agency` pour un manager `active`, `self` pour les autres). Hors RLS, et dans la même transaction que la fiche : il écrit dans `user` le compte d'un nouveau membre (sans mot de passe, rôle `operator`), son nom et ses créatrices ; il lit `account` pour savoir si le mot de passe est choisi ; il supprime les lignes de `session` d'un membre qui part. Ces tables restent celles de Better Auth (`auth.ts`).

**Règles propres** (`domain/members.ts`, testées) :

- un taux ou un préréglage commence aujourd'hui au plus tôt, dans le fuseau de l'agence (Europe/Paris tant que l'agence n'a pas son réglage), sauf le premier taux d'un membre, qui commence le jour de son arrivée ;
- un nouveau taux d'un membre commence le 1er ou le 16 d'un mois, le premier jour d'une quinzaine (Charles, 28/10) : une quinzaine n'est jamais payée à deux taux et rien n'est recalculé en arrière ; quand il commence aujourd'hui, la paie recalcule la quinzaine en cours, comme après un changement de rôle (`payroll.recalculate`, que le composition root lui passe) ;
- un taux n'est jamais modifié : un nouveau taux est une nouvelle ligne, une par membre et par jour ;
- le rôle d'équipe est daté comme le taux (Charles, 28/10) : le premier part du jour d'arrivée, un changement (chatteur ↔ manager) part du 1er ou du 16 d'un mois, aujourd'hui au plus tôt (`role_date_invalid`), une ligne par membre et par jour (`role_change_conflict`), jamais modifiée. Le rôle d'un jour est la dernière ligne en vigueur ce jour-là (`roleOn`) ; la paie lit celui du dernier jour de la quinzaine, donc un seul rôle par quinzaine : un chatteur promu le 16 touche la part d'équipe à partir de cette quinzaine, un manager rétrogradé le 16 la garde pour la quinzaine d'avant. `team_members.team_role` reste le rôle d'aujourd'hui, celui que lisent les scopes (`withMember`), `/v1/me` et les écrans : un rôle qui part d'aujourd'hui l'écrit tout de suite et met `payroll.recalculate` de la quinzaine en cours en file ; un rôle d'un jour à venir l'écrit ce jour-là, par le job `team.apply_roles` ;
- seul un manager a une part du net de l'équipe, au premier jour du taux : une part à partir d'un jour où le membre sera chatteur est refusée (`team_share_invalid`), même s'il est manager aujourd'hui ;
- un membre parti ne change plus ; partir vide ses créatrices et ferme ses sessions dans la même transaction (le reste du départ est EQ-14) ; il ne peut plus se connecter, et une session qui lui resterait est refusée à la requête suivante (`apps/api/src/auth.ts`) ;
- les notes internes et les préréglages se lisent par le propriétaire et les managers actifs, jamais par le membre dont parle la note : refusé (403) plutôt qu'une liste vide ;
- un pays écrit est l'un des codes ISO 3166-1 (`KnownCountryCodeSchema`) ; une lecture garde la seule forme, pour qu'une ligne plus ancienne reste lisible.

**Routes** (`routes(requireRole)`, montées sous `/v1`, contrats `packages/contracts/src/team-members.ts`) :

- lecture pour le propriétaire et les comptes de l'équipe, jamais pour une créatrice : `GET /team/members`, `GET /team/members/:memberId`, `GET /team/members/:memberId/commission`, `GET /team/members/:memberId/role`, `GET /team/commission-presets`, `GET /team/members/:memberId/notes` ;
- écriture par le propriétaire seul : `POST /team/members`, `PATCH /team/members/:memberId` (sans le rôle : un `teamRole` y est refusé, `request_invalid`), `PUT /team/members/:memberId/status`, `POST /team/members/:memberId/commission`, `POST /team/members/:memberId/role` (`{ teamRole, effectiveFrom }`), `POST /team/commission-presets` ;
- notes : `POST /team/members/:memberId/notes` par le propriétaire et les managers actifs.

Chaque écriture entre au journal (`audit_log`) sans nom, e-mail ni texte de note.

Aucun écran ne change encore le rôle (les gestes de la fiche sont EQ-14) : le contrat est `SetTeamRoleBodySchema` et `TeamRoleHistorySchema` (`packages/contracts/src/team-members.ts`), et l'écran proposera le prochain 1er ou 16 comme le fait celui du taux, avec les messages de `role_date_invalid` et `role_change_conflict` déjà dans `ERROR_MESSAGES` (`apps/web/src/screens/team/model.ts`).

**Job.** `team.apply_roles`, chaque heure (`crontab.ts`), sur la connexion admin : chaque fiche prend le rôle en vigueur aujourd'hui dans le fuseau de l'agence, pour qu'un rôle daté d'un 1er ou d'un 16 à venir s'applique ce jour-là à l'accès. Rejoué, il ne change rien de plus. La paie ne l'attend pas : elle lit les rôles datés. Dans la première heure du jour, l'accès peut garder l'ancien rôle jusqu'au passage du job.

**Pour les autres modules.** `pay.members(tx, day)` (EQ-04), dans la transaction de la paie que le composition root lui passe (celle du job, sur la connexion admin, ou celle d'une validation, sous `withMember`) : chaque membre, partis compris (leurs rapports se paient encore), avec son statut, son arrivée, et le rôle et le taux en vigueur ce jour-là (le rôle de sa fiche s'il n'a aucun rôle daté avant ce jour). Le lien d'invitation d'un membre (EQ-10) a son propre serveur (`apps/api/src/invitation-links.ts`) : le module ne touche pas à sa table. Il en reçoit seulement, par `InvitationLinkDirectory`, la date où le lien en cours cesse de marcher (`invitationExpiresAt`, même passée, pour « Lien expiré ») ; `null` quand aucun lien n'est en cours (jamais créé, ou déjà utilisé). Un lien de nouveau mot de passe compte aussi : le propriétaire le voit en cours au lieu d'en créer un second qui l'annulerait.

## Structure

- `domain/` : règles pures, erreurs, ports. Zéro I/O.
- `application/` : le service de l'équipe (lectures, écritures, résolution d'un préréglage en taux).
- `infra/` : le magasin Drizzle (`withMember`), les lectures de la paie, le job des rôles et les routes Fastify.
- `index.ts` : **seule** porte d'entrée publique du module.

Voir `docs/architecture/modules.md` pour les règles communes.
