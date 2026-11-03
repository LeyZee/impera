# CR-14 Créneaux datés, places et fans confiés : le modèle de données de l'ADR 0049
Statut : in_progress, lot a fusionné (#440), lot b1 en relecture (ADR 0049, acceptée par Charles le 02/11/2026 à 18h36 ; fiche ouverte le 03/11/2026 pour porter la base que CR-12 lit et que CR-13 écrit)
Phase : espaces (ADR 0045, ADR 0049)
Dépend de : EQ-02 (module `scheduling`), CR-12 lot a (lecture du calendrier)
Branche : task/cr-14-slot-settings-and-seats-data (lot a : `claude/project-thread-1yc7m9-adr-0049`)

## Objectif
La base sait ce que l'ADR 0049 décide : des créneaux aux heures libres réglés par versions datées, des places par compte et par créneau, trois chatteurs au plus en même temps sur un compte, et les fans confiés quand plusieurs sont en poste. Rien ne change pour l'utilisateur tant que les écrans de CR-12 (lot d2) et de CR-13 ne s'en servent pas.

## Contexte à lire
`docs/adr/0049-free-slots-seats-and-shared-fans.md` (tout), `docs/adr/0045-shift-calendar-for-everyone.md` (§ 2, § 3), `docs/adr/0048-agent-in-the-shift-calendar.md` (§ 1, « IA seule »), `docs/adr/0031-leaves-and-shift-swaps.md` (verrou par membre), `docs/adr/0025-chatter-access-during-shift.md`, `packages/db/migrations/0021_scheduling.sql` (exclusions, déclencheurs du planning), `apps/api/src/modules/scheduling/README.md`, CR-12 et CR-13.

## À faire
### Lot a : la base et la garde du serveur (migration 0078)
- [x] `scheduling_slot_versions` : une ligne par version du réglage des créneaux (`effective_at`, fuseau de la grille, créneaux en minutes murales avec un nom facultatif, auteur). Une version qui a pris effet est immuable (déclencheur) ; une version future se retire tant qu'elle n'a pas pris effet. Le réglage en vigueur à un instant est la dernière version dont `effective_at` est passé. La version d'aujourd'hui est recopiée du réglage actuel (`scheduling_settings`), sans rien changer à ce que lit la grille.
- [x] `scheduling_slot_seats` : version, rang du créneau, compte (clé étrangère), `seats` entre 1 et 2. Une ligne absente vaut 1.
- [x] `shifts_account_overlap_excl` retirée (la 0021 ne change pas) et remplacée par un déclencheur de contrainte `DEFERRABLE INITIALLY DEFERRED` qui refuse un quatrième shift non annulé en même temps sur un compte, quel que soit le chemin d'écriture ; un verrou consultatif par compte (`scheduling.account:`), pris avant ceux des membres, chacun par ordre d'identifiant, par chaque écriture qui pose ou déplace un shift.
- [x] **Rien ne change à l'écran** : tant que le renfort n'existe pas (CR-13), le serveur refuse lui-même un second shift sur un compte à la même heure (`shift_account_conflict`, le même code et le même shift en travers qu'aujourd'hui), sous le verrou du compte. Les modèles gardent `account_taken`.
- [x] `shift_fan_assignments` : `creator_id` (RLS), compte, fan, membre, shift, `starts_at`, `ends_at` nul tant que l'attribution court ; un fan n'a qu'un chatteur à la fois (exclusion sur la plage) ; ligne immuable sauf la fermeture de `ends_at`, une seule fois ; rien ne s'efface. RLS : un membre lit ses lignes, le propriétaire et l'agence lisent tout, la créatrice ne lit rien. Personne ne l'écrit encore : le routage viendra avec la capture Reveal (EQ-08).
- [x] La paie lit toujours les shifts par `scheduling.pay.shifts` (membre, compte, début, fin, arrêt) : colonnes et sens inchangés.

### Lot b : le contrat et la lecture
- [x] `SchedulingSettingsSchema` porte la liste des créneaux (début, fin, nom facultatif) et les places par compte ; `refine` Zod (24 h sans trou ni chevauchement, de 1 h à 12 h, à l'heure pleine, au moins deux créneaux), revérifié par le domaine à l'écriture ; lecture d'un réglage passé par `at` ; la grille lit le réglage en vigueur jour par jour.
- [ ] `slotsToFill` compte des places ; « IA seule » ne tient lieu que d'une place unique (ADR 0048 § 1).
- [ ] Le rang d'une place existe dans sa version (domaine, revérifié à l'écriture ; déclencheur d'insertion si Bilan le demande), relevé de la relecture de Bilan sur #440.
- [ ] README du module : la limite de trois tient parce que les écritures sur `shifts` tournent en READ COMMITTED (le comptage de `shifts_account_cap` lit après le verrou) ; une écriture en repeatable read la casserait.
- [ ] Écriture d'une version (propriétaire seul) et retrait d'une version future, au journal d'audit ; le recalage de la semaine modèle et l'écran restent à CR-13.
- [ ] Les modèles de shift et `make-shifts` gardent leurs heures quand une version change les créneaux (test) : un shift posé aux heures d'un autre créneau serait payé faux (Équipe sur #442).

## Critères d'acceptation
- Tests d'intégration : version effective refusée en modification et en suppression, version future retirée ; quatrième shift refusé sur un compte quel que soit le chemin, y compris en écrivant par le rôle admin ; deux renforts concurrents sur un compte qui en a déjà deux, un seul passe (lot b ou CR-13, quand le renfort existe) ; second shift refusé par le serveur avec `shift_account_conflict` comme aujourd'hui.
- Test RLS de `shift_fan_assignments` : membre (ses lignes), propriétaire et agence (tout), créatrice (rien), autre créatrice (rien) ; une ligne ne change que par la fermeture de `ends_at`, une seule fois ; un fan n'a jamais deux lignes ouvertes en même temps.
- Le test de référence de la paie (`payroll-reference.json`) reste identique.
- Drift Drizzle aligné (`check-drift` de `packages/db`) ; migration additive sauf le retrait d'une contrainte, remplacée dans la même migration.

## Hors périmètre
Les écrans (CR-12 lot d2, CR-13), le recalage des modèles (CR-13), le routage d'un `sale` vers le fan confié et le signal des ventes déclarées en double (EQ-08, CR-09), le signal de rush (après la capture Reveal).

## Notes de session

- Lot a (03/11) : migration 0078 sur 0077. La version recopiée prend `effective_at = '-infinity'`, pour couvrir tout le passé ; ses créneaux sont `{ startMinute, endMinute, name: null }`, la fin modulo 1440 (« 18 h – 0 h » finit à 0). Sans ligne `scheduling_settings`, aucune version : le module garde ses valeurs par défaut, et le lot b lira « aucune version » comme elles.
- `shifts_account_cap` est `SECURITY DEFINER` (le décompte lit tous les shifts du compte) et prend lui-même le verrou `scheduling.account:` avant de compter : deux écritures qui ne passent pas par le serveur (rôle admin) ne passent pas toutes les deux non plus (test de deux écrivains concurrents). Il relit la ligne à la validation : un déplacement se juge sur sa place finale. Erreur `23P01` nommée `shifts_account_cap`, que le serveur ne voit jamais tant qu'il ne garde qu'un shift par compte.
- L'index GiST `shifts_account_range_idx` (compte, plage, shifts non annulés) remplace celui que portait l'exclusion retirée : la garde du serveur et la paie le lisent.
- `shift_fan_assignments` : le rôle de l'application n'a que `SELECT` ; EQ-08 donnera l'insertion et la fermeture avec leurs politiques. L'exclusion porte sur `tstzrange(starts_at, ends_at, '[)')`, une fin nulle étant l'infini.
- Les places d'une version passée sont figées par un déclencheur (`refuse_effective_slot_seats`), y compris pour le rôle admin ; une version future se retire entière (cascade) et se réécrit, jamais modifiée.
- Lot b1 (03/11) : `SchedulingSettingsSchema` = fuseau, marge, `versions` (la version en vigueur au début de ce qu'on lit, puis celles qui prennent effet avant sa fin, ou toutes celles à venir pour `GET ?at=`). `SHIFT_SLOT_LENGTHS_MINUTES` disparaît ; `ShiftSlotsSchema` porte le `superRefine` (24 h sans trou ni chevauchement, 1 h à 12 h, à l'heure pile, 2 à 24). `PUT /scheduling/settings` n'écrit plus que le fuseau et la marge (corps strict) ; les colonnes `slot_*` de `scheduling_settings` restent pour la 0078 et ne sont plus lues.
- Découpage jour par jour (`slotWindowsOf`, contrat, partagé par le serveur et le web) : un créneau appartient à la version en vigueur à son début ; celui qui précède le premier créneau d'une nouvelle version finit où elle commence (raccourci ou étiré). Une version qui prend effet un lundi à 5 h sur des créneaux de minuit garde donc un créneau 0 h – 5 h de l'ancienne version le lundi. Les créneaux d'une version se lisent dans le fuseau de la grille d'aujourd'hui ; `time_zone` de la version garde celui de son écriture.
- Les places ne partent qu'au propriétaire et à l'agence ; « à pourvoir » en places, l'écriture et le retrait d'une version : lot b2.
- Relectures de #442 : la grille prend autant de lignes que le jour qui a le plus de créneaux dans la semaine, le « + » sur la dernière (Extension) ; la semaine du calendrier finit au premier créneau du lundi suivant dans la version alors en vigueur ; `planning()` lit les réglages sur la même plage que ses shifts, un jour de chaque côté (Équipe). Une base de dev dont `scheduling_settings` a un premier créneau hors de l'heure pile donne une version que la 0078 recopie telle quelle et que le contrat refuse : le planning répond 500 (Bilan) ; rien n'est déployé, on corrige la ligne à la main sur la base de dev.

