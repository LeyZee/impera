# EQ-05 Paie : écrans de validation, de paiement et commissions du chatteur
Statut : done : écrans dans main (#281, 28/10/2026, relus par Extension et Bilan), avec le paiement par WorldRemit seul (migration 0033) ; l'API qu'ils lisent aussi (lots 3a à 3e d'EQ-04, #271 à #275, et les ajouts d'EQ-05, #279) (lot 3 de l'ADR 0023, ID validé par Charles le 27/10/2026)
Phase : équipe (ADR 0023)
Dépend de : EQ-04 (lot 3 : validation, saisies, paiement, règles, taux) ; EQ-11 (fait)
Branche : task/eq-05-payroll-screens

## Objectif
Valider et payer les paies depuis l'onglet Paie, à la place que fixe l'ADR 0024, et laisser chaque chatteur suivre ses commissions, période par période, ligne par ligne.

## Contexte à lire
`docs/adr/0023-team-management.md` (§ Paie, § Factures pour « payée »), `docs/adr/0024-roles-and-navigation.md`, `docs/adr/0032-pay-period-closing.md`, `docs/adr/0033-exchange-rate-source.md` (source des taux), `docs/adr/0035-pay-entry-locks.md` (verrous des saisies), `apps/api/src/modules/payroll/README.md`, `packages/contracts/src/payroll.ts`, `docs/design/README.md`, `packages/design-system/README.md`, `docs/conventions/api.md`. Maquettes : https://claude.ai/artifact/XYE7FJob2hX9fkssZ8Yz5T (Nuit et Jour, 1 440 et 390 px, mouvement réduit).

## Ce que l'API donne déjà (EQ-04)
| Route | Qui | Ce que l'écran en fait |
| --- | --- | --- |
| `GET /v1/payroll/periods/:period` | tous (le sien pour un membre) | Quinzaine, relevé, objectifs : relevés avec leurs lignes, règles copiées, `team`, `canValidate`, `revision`, `computedAt`, clôture (sa date seule pour un membre : `closedBy` et `exchangeRates` à `null`), paliers, objectif, minimum |
| `POST /v1/payroll/statements/:id/validate` `{ revision }` | propriétaire, manager actif, jamais le sien | « Valider » et « Valider (n) » |
| `POST /v1/payroll/statements/:id/pay` | propriétaire | « Marquer payé » (corps du premier ajout ci-dessous) |
| `POST /v1/payroll/bonuses`, `/penalties`, `/adjustments`, `…/:id/cancel` | propriétaire, manager actif, jamais pour soi | Primes et malus |
| `POST /v1/payroll/bonus-tiers`, `POST /v1/payroll/collective-goals` | propriétaire | Objectifs |
| `GET`, `PUT /v1/payroll/settings` | lecture : tous ; écriture : propriétaire | Minimum de versement, dans Réglages › Règles de paie |
| `GET /v1/payroll/exchange-rates` | propriétaire, manager actif | Le dernier taux lu, dans l'avis « taux de la BCE manquant ». Le survol d'une ligne en dollars montre le taux de la ligne (`rateMicros`), le seul qu'un membre lit |
| `GET /v1/team/members`, `GET /v1/team/pay-rules`, `GET /v1/scheduling/shift-reports?period=` | agence | Noms et couleurs (`validatedBy` et `paidBy` sont des `userId`), comptes et créatrices d'une ligne, rapports derrière une ligne |

## Ce que l'API a ajouté pour les écrans (#279 : Équipe en ajout seul, Bilan relit)
1. **Les détails du paiement.** L'ADR 0023 (§ Factures) veut que « payée » porte la date, le moyen, la référence du transfert et le montant envoyé, et EQ-06 rattache ce transfert aux factures qu'il solde.
   - Migration 0031 : `paid_on`, `payment_method`, `payment_reference` et `sent_minor` sur `commission_statements`, vides jusqu'au paiement. Une contrainte veut la date, le moyen et le montant si et seulement si le relevé est payé ; la référence reste facultative.
   - La garde `keep_commission_statement` est réécrite par `CREATE OR REPLACE` dans 0031, sans toucher 0028 ni 0029. Le passage de validé à payé n'écrit que ces quatre colonnes, le statut, `paid_at` et `paid_by`, et le droit `UPDATE` de l'application s'étend à ces quatre colonnes seulement.
   - Corps `{ revision, paidOn, method, reference?, sentMinor }`, en Zod. Une autre révision donne `commission_statement_changed_conflict`.
   - `paidOn` n'est jamais dans le futur, dans le fuseau de l'agence (`payment_in_future_unprocessable`), ni avant le premier jour de la quinzaine du relevé (`payment_before_period_unprocessable`) : une faute d'année resterait figée sur un relevé payé (relecture de Bilan sur #279).
   - `sentMinor` est le montant à verser, sinon `payment_amount_unprocessable`. C'est le défaut ; l'autre choix (l'écart devient un ajustement de la quinzaine suivante) est une question à Charles.
   - `method` vient de `PAYMENT_METHODS`, une liste fermée dans les contrats : `worldremit` seul (WorldRemit), le moyen qui paie les chatteurs, au Bénin compris (Charles, 28/10/2026). La migration 0033 remplace la liste par défaut de 0031 (virement, Wise, PayPal, autre), posée faute de réponse. Le champ reste dans le corps : un moyen de plus demande une migration de la contrainte, jamais un texte libre.
   - `payment_reference` est la référence du transfert (1 à 100 caractères), jamais un IBAN ni un numéro de compte : l'écran et la doc le disent, et le contrat refuse une référence qui contient un IBAN (`containsIban` : code pays, longueur du pays et clé mod 97 sur un passage du texte ; registre ISO 13616 plus les zones UEMOA et CEMAC). L'écran applique la même règle avant l'envoi.
   - Un relevé à verser nul (report, quinzaine sans vente) reste validé : il n'y a rien à payer.
2. **L'index des quinzaines.** `GET /v1/payroll/periods?limit=&cursor=`, de la plus récente à la plus ancienne, par curseur (`cursor_invalid` sinon). Une route du module payroll, son DTO dans les contrats, aucune migration. Une ligne par quinzaine où le lecteur lit au moins un relevé :
   - `window` (la quinzaine, ses bornes, son fuseau), `ended`, puis `closedAt` et `closedBy` à plat, sans objet de clôture : `null` tant que la quinzaine n'est pas close, et `closedBy` toujours `null` pour un membre, qui ne lit que la date ;
   - `statements`, le nombre de relevés par statut (`draft`, `validated`, `paid`) et `carried`, les relevés validés ou payés qui ont reporté leur total (jamais un relevé à valider) ;
   - `netMinor`, `payableMinor` et `paidMinor`, sommes des relevés lus ; `validatedPayableMinor` et `carriedMinor`, les mêmes sommes sur les seuls relevés validés ou payés : ce qui est dû et ce qui est reporté. `carriedMinor` garde le signe de chaque report (positif sous le minimum, négatif sous zéro) : pour un membre, c'est ce qui passe sur la quinzaine suivante ; sur l'équipe, c'est un solde des deux sortes, à ne jamais afficher comme un montant dû ou repris. « Reste à envoyer » vaudra `validatedPayableMinor − paidMinor` : Historique et Commissions liront ces champs à la suite de #294 (`apps/web/src/payroll/model.ts` change dans les deux PR, la seconde à entrer résout le conflit).

   Le propriétaire et le manager lisent l'équipe, le chatteur son seul relevé (RLS) : la même route sert Relevés et Mes relevés.
3. **Le relevé après une validation de rapports.** Le lot 3a le fait déjà : valider un rapport met `payroll.recalculate` en file dans la même transaction, avec la clé `payroll.recalculate:<quinzaine>` en remplacement (une rafale de validations donne un seul calcul, 5 s après la dernière). La clé est par quinzaine et non par membre, parce que l'objectif collectif et la part d'équipe d'un manager dépendent des autres relevés. Sur une quinzaine close, le travail recalcule la première quinzaine ouverte, où va le rapport (ADR 0032). Le passage horaire reste en filet. Un test montre la rafale et le refus. L'écran dit « Calculé à 10 h 07 » sous la liste et dans le relevé. Après un refus `commission_statement_changed_conflict`, il relit le relevé jusqu'à la révision suivante, et ne revalide jamais tout seul.

4. **Les saisies d'une quinzaine**, trouvé en codant Primes et malus. `GET /v1/payroll/entries?period=` (`PayrollEntriesSchema`) : ses primes, les malus qui la couvrent et ses ajustements, annulés compris, en une lecture sous `withMember`.
   - Un malus couvre une quinzaine selon `penaltyCovers`, la règle même du moteur : la route et le moteur lisent les mêmes malus, sans recopie en SQL.
   - Un membre ne lit pas les auteurs (`createdBy` et `cancelledBy` à `null`), ni ici ni dans les relevés : une seule fonction, `redactAuthors`, sert les deux routes.
   - Au plus 500 saisies de chaque sorte : au-delà, `payroll_entries_too_many_unprocessable`, jamais une liste coupée.

L'export CSV d'une quinzaine se fait dans le navigateur, depuis la lecture de la quinzaine : mêmes données, aucune route ni aucun droit nouveau. L'export comptable reste à EQ-06, côté serveur.

## Écrans
Paie (propriétaire et manager) a les sous-onglets de l'ADR 0024, dans son ordre : Quinzaine · Relevés · Primes et malus · Objectifs. Factures et Export comptable arrivent avec EQ-06 : un onglet n'apparaît que quand son écran existe. Chez le chatteur, l'écran est Commissions.

Ce qui vaut pour tous les écrans (relecture d'Extension, 28/10) :
- `/paie` et `/commissions` sont déjà dans `apps/web/src/shell/nav.ts`. La PR les ajoute à `READY_SECTIONS` et met à jour les listes d'onglets de `nav.test.ts` et `AppShell.test.tsx` ; sur le téléphone du propriétaire, Entraîner passe sous « Plus », comme le test le prévoit.
- Les sous-onglets sont `SubNav` tel quel (fondu du bord, défilement, onglet actif centré, dans `layout.tsx`). Rien n'est réécrit.
- L'écran de paie importe `@/reports/reports.css` lui-même : `rp-review`, `rp-notice` et `rp-account` n'y sont pas chargés autrement. Les classes `py-*` n'utilisent que des jetons et ne redéfinissent aucune classe `rp-*` ni `nv-*`.
- Un néon par écran : « Valider » dans Quinzaine, « Ajouter » dans Primes et malus, la jauge dans Objectifs, le héros dans Commissions. « À verser » n'est donc pas un `nv-stat--hero`.
- L'eyebrow au-dessus du titre nomme le sous-onglet (« Quinzaine », « Relevés »…), jamais la période, qui est déjà dans le sélecteur. Commissions, sans sélecteur, garde la période.
- Un seul formateur signé pour la paie : `signedAmountText` de `reports/model.ts` passe à `Intl.NumberFormat` avec `signDisplay: 'exceptZero'`, le signe collé au chiffre (« +30,00 € », « −15,00 € », « −10 % », « +12 % »). En `fr-FR`, `Intl` écrit le trait d'union (U+002D) : le vrai signe moins (U+2212) est posé à la main à sa place (la part `minusSign` de `formatToParts`, par exemple), et un test exige « − ». Les corrections de rapports, qui l'utilisent déjà, suivent ; leurs tests aussi.
- L'interface ne nomme jamais une couleur.
- `reports.css` change pour tous les écrans qui l'utilisent, dans la PR du code ou une petite PR avant :
  - la marque de `rp-notice` devient un trait droit de 3 px à côté du texte (`::before`, de la première ligne à la dernière), au lieu d'une ombre intérieure qui suit l'arrondi. Pas d'`overflow: hidden`, qui couperait le halo d'un bouton néon dans l'avis ;
  - `rp-account[data-missing='true']` reste neutre et « Aucune règle pour l'instant. » passe en `ink-muted` : l'avis au-dessus suffit.

- [x] **Quinzaine** (la période en cours, ou celle choisie dans Relevés).
  - En-tête : les dates, un état qui dit qui a la main (« En cours, finit le 31 oct. », « Finie : à valider », « Close le 3 nov. par Charles »), et la quinzaine précédente ou suivante.
  - Le chiffre qui domine : « À verser » quand la quinzaine est finie, sinon le net de l'équipe et sa prévision de fin. Au plus trois chiffres secondaires : prévision, écart avec la quinzaine précédente, objectif collectif.
  - Une ligne par membre (`rp-review`) : couleur, nom, rôle, net, total, état, écart, et le malus signé comme partout (« malus −15,00 € »). États : Brouillon, Validé, Payé, Reporté (sous le minimum). Un report n'a qu'une marque, l'étiquette ambre « Reporté » ; sa phrase est en `ink-muted` et la ligne n'a pas de bord.
  - Sélection et « Valider (n) » en néon. Une ligne cochée a un seul état visuel, `rp-review[data-checked='true']`, et pas de `nv-tap`, dont le survol cacherait la sélection. Au bureau, « Valider (n) » est dans l'en-tête ; au téléphone, il est sur la ligne « Tout sélectionner n sur n », où il dit « Valider » puisque le nombre est à côté.
  - Le relevé du lecteur a sa case éteinte, comme son propre rapport dans Équipe › Rapports, et dit « Ton relevé : un autre membre de l'agence le valide ».
  - Le compteur de l'onglet Quinzaine est un compteur d'action : il n'apparaît que quand « Valider » est possible.
  - Ce qui bloque la validation, en ambre et au-dessus de la liste, avec le lien qui le lève : rapports à relire (Équipe › Rapports), taux de la BCE manquant, membre sans taux de commission (Équipe › Membres). Tant qu'un blocage est affiché, ni « Valider », ni les cases, ni le compteur : le bouton de l'avis dit quoi faire.
  - Une fois la quinzaine close, un cadenas : « Close le … : un rapport validé maintenant va sur la quinzaine suivante ».
  - Il n'y a pas de route de lot. « Valider (n) » envoie relevé par relevé, dans l'ordre des membres. Chaque refus reste sur sa ligne, et les autres relevés passent.
  - Toute validation passe par l'îlot « Annulable quelques secondes » (EQ-03), la première clôture comprise : « Clore et valider » ferme la fenêtre de clôture et tient l'envoi cinq secondes, puis l'îlot dit ce qui est passé (« 3 validés, 1 non validé » et la raison). Un arrêt pour toute la quinzaine (serveur absent, refus de la quinzaine) reste affiché tant que la quinzaine relue après l'envoi ne change pas.
  - Ouverte sans quinzaine choisie, la page garde la quinzaine qu'elle a ouverte : valider ou payer son dernier relevé change celle qu'elle ouvrirait, jamais celle qu'elle montre.
- [x] **Relevé** (panneau ouvert depuis une ligne) : le parcours de l'argent.
  - Compte par compte : brut dans la devise, en euros au taux de la BCE de la ligne (`rateMicros`, au survol), hors TVA, net de la plateforme, commission au taux du membre.
  - Puis : palier, objectif collectif, part d'équipe d'un manager, primes, malus (demandé et retenu, avec le plafond), reports reçus, ajustements, total, report sortant, « À verser ».
  - Replié par défaut : les règles copiées, la révision, « Calculé à », la version du moteur, les rapports derrière chaque compte.
  - Actions :
    - « Valider (révision n) » ;
    - « Marquer payé », propriétaire seul, en deux temps (remplir, relire) : la date (aujourd'hui par défaut, jamais avant la quinzaine ni après aujourd'hui), le montant envoyé (« À verser », un autre est refusé) et la « Référence WorldRemit, facultative », avec l'aide « Celle que WorldRemit donne au transfert. Jamais un IBAN, un numéro de compte ni de téléphone. ». Aucun choix de moyen : WorldRemit est le seul, et la relecture le dit (« … le lundi 2 novembre par WorldRemit … »). Le bouton reste occupé jusqu'à la relecture de la quinzaine, comme tous les formulaires de la paie : un second clic n'envoie rien ;
    - « Ajuster », sur un relevé validé ou payé (l'ajustement va sur la quinzaine que choisit le serveur, et l'écran la dit avant l'envoi).
- [x] **Relevés** : les quinzaines, de la plus récente à la plus ancienne (l'index, deuxième ajout). Chacune montre son état (En cours, Finie : à valider, Close, Payée) et s'ouvre en Quinzaine, en lecture pour une quinzaine close.
  - La colonne de droite n'a qu'une grandeur : le versé (« versé »), ou ce qui reste à verser (« à verser à ce jour » pour la quinzaine en cours, « à verser » pour une close).
  - Le net, la clôture et le nombre de relevés par état vont sur la ligne du dessous : « Close le 2 nov. par Charles · 2 655,68 € de net · 3 payés, 1 reporté ».
- [x] **Primes et malus** : les saisies de la quinzaine, membre par membre, et une saisie annulée reste barrée. Chaque montant montre son signe : « +30,00 € », « −15,00 € », « −10 % », « −12,40 € ».
  - « Ajouter » en deux temps (remplir, relire) : prime, malus fixe, malus en pourcentage ou ajustement ; le membre (jamais soi : son nom n'est pas dans la liste) ; la quinzaine ; le montant ; le motif, obligatoire.
  - « Annuler » une prime ou un malus après une confirmation, en petit bouton discret (`nv-btn--plain nv-btn--sm`) qui se remplit au survol.
  - Jamais « sanction ».
- [x] **Objectifs**.
  - L'objectif collectif de la quinzaine : cible, paliers en pourcentage et prime par chatteur, progression avec la marque de la prévision.
  - Les paliers individuels en vigueur et leur quinzaine de départ.
  - Le propriétaire les change à partir d'une quinzaine pas encore validée, et le manager les lit. Une quinzaine figée dit pourquoi (`pay_period_closed_conflict`).
- [x] **Réglages › Règles de paie** (propriétaire) gagne le minimum de versement : 15 € par défaut, un changement s'applique aux brouillons.
- [x] **Commissions** (chatteur ; le manager lit son propre relevé dans Paie, case éteinte).
  - Le héros : ce que tu touches à ce jour pour la quinzaine. Il dit si c'est encore en calcul, validé ou payé, et la date du paiement quand il est payé. Un relevé payé parle au passé, en haut comme en bas (« Ce que tu as touché »).
  - « Le parcours de ton argent » : du brut à ce que tu touches, ligne par ligne, puis report et versement attendu. Jamais de date de versement promise.
  - « Ma performance » : ce qu'il te reste à faire pour le palier suivant, et ta part de l'objectif collectif quand la quinzaine en a un. Jamais de classement ni le montant d'un autre.
  - « Mes relevés » : les quinzaines passées, avec leur état et leur total.

**Indicateurs de la paie**, dans Paie et jamais sur le Dashboard (ADR 0024).
- [x] Prévision de fin de quinzaine : un calcul pur et testé dans `apps/web`, sur le net de l'équipe, les rapports validés et le rythme des jours écoulés dans le fuseau de l'agence.
- [x] Progression de l'objectif collectif.
- [x] Répartition des ventes par plateforme et par créatrice, depuis les lignes : la barre empilée du design system (`nv-split`) et sa légende (`nv-legend`), dans la suite de couleurs des parts (`data-1`, `data-2`, puis l'encre à 60 % et 25 %) ; quatre parts au plus, les plus petites réunies dans « Autres ».
- [x] Écart avec la quinzaine précédente, en lisant deux quinzaines.

- [x] **Export CSV** des relevés d'une quinzaine : membre, lignes, primes, malus, report, total, à verser. Un nom qui commence par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot prend une apostrophe devant, pour qu'aucun tableur ne le lise comme une formule ; les montants gardent leur signe moins. Le fichier reste lisible une minute après le début du téléchargement.
- [x] **Vocabulaire du glossaire** : relevé de commissions, commission, malus, report, à verser. Jamais « fiche de paie » ni « salaire » dans ce que voit un chatteur.

## Refus de l'API, en français (codes de `PAYROLL_ERROR_CODES`)
| Code | Ce que dit l'écran |
| --- | --- |
| `commission_statement_changed_conflict` | « Ce relevé a changé depuis que tu l'as ouvert. Relis la nouvelle version avant de valider. » |
| `commission_statement_status_conflict` | Si le relevé est déjà validé ou payé, l'écran le recharge sans message (valider ou payer deux fois ne fait rien de plus). Sinon : « Ce relevé n'est pas encore validé. », ou pour un relevé affiché validé que la relecture ne montre pas payé (serveur absent) : « Ce relevé n'est plus à payer : il a déjà été marqué payé. » |
| `commission_statement_open_conflict` | « La quinzaine n'est pas finie : elle se valide à partir du {lendemain}. » |
| `commission_statement_order_conflict` | « Valide d'abord le relevé de {membre} du {quinzaine}. » |
| `pay_period_order_conflict` | « Valide d'abord la quinzaine du {quinzaine}. » |
| `pay_period_reports_pending_conflict` | « {n} rapports de la quinzaine attendent leur relecture. » avec le lien Équipe › Rapports |
| `pay_period_reports_unread_conflict` | « {n} rapports sont sur des créatrices que tu ne suis pas : le propriétaire valide cette quinzaine. » |
| `pay_period_closed_conflict` | « La quinzaine du {quinzaine} est déjà validée. » |
| `penalty_cancel_conflict` | « Ce malus porte sur des quinzaines toutes validées : passe par un ajustement. » |
| `exchange_rate_missing_conflict` | « Le taux du dollar de la BCE manque pour la fin de la quinzaine. Il arrive chaque jour ouvré vers 16 h. » |
| `commission_rate_missing_conflict` | « {membre} n'a pas de taux de commission en vigueur. » avec le lien Équipe › Membres |
| `payroll_own_forbidden` | « Personne ne décide de sa propre paie : un autre s'en charge. » |
| `payroll_forbidden` | « Seul le propriétaire peut le faire. » |
| `bonus_conflict`, `penalty_conflict`, `pay_adjustment_conflict`, `bonus_tier_set_conflict`, `collective_goal_conflict` | « Cette saisie existe déjà avec d'autres valeurs : recharge la page. » |
| `payment_in_future_unprocessable` | « Le paiement ne peut pas être daté après aujourd'hui. » |
| `payment_before_period_unprocessable` | « Le paiement ne peut pas être daté avant le début de la quinzaine ({jour}). » |
| `payment_amount_unprocessable` | « Le montant envoyé doit être celui à verser : {montant}. » |
| `cursor_invalid` | Rien à dire : Relevés recharge la liste depuis le début. |
| `pay_period_not_computed_conflict` | « La paie n'a pas encore calculé cette quinzaine : réessaie dans quelques minutes. » |
| `payroll_entries_too_many_unprocessable` | « Trop de saisies sur cette quinzaine pour les lister ici. » |
| `team_member_not_found` | « Ce membre n'est plus dans l'équipe : la page est relue. » |
| `commission_statement_not_found` | « Ce relevé n'existe plus : la page est relue. » |
| `bonus_not_found`, `penalty_not_found` | « Cette saisie n'existe plus : la page est relue. » |

## Critères d'acceptation
- Un chatteur ne voit que ses relevés. Une erreur affiche « Le serveur ne répond pas », jamais un faux état vide.
- Valider deux fois le même relevé ne fait rien de plus. Un brouillon modifié entre l'affichage et la validation donne le message du 409, pas une erreur brute.
- « Payé » est absent pour un manager (masqué, et refusé par l'API).
- Aucune case active ni aucune saisie pour soi : le nom du lecteur n'est pas dans la liste des membres d'une saisie.
- Tests de la prévision :
  - une période vide ;
  - une période terminée, où la prévision vaut le réalisé ;
  - un rapport validé tard.
- Un chatteur ne lit que sa progression, jamais les montants d'un autre.
- Finition (Charles, 27/10, 15h22 : « que ce soit vraiment très joli… des hovers partout… une belle hiérarchie des informations ») : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, bureau et téléphone, mouvement réduit).

## Hors périmètre
Factures, avoirs et export comptable (EQ-06), facturation des créatrices et pénalités de retard, rapprochement bancaire (plus tard selon l'ADR).

## Notes de session
- 2026-10-28 (fil Équipe) : fiche reprise d'après l'API d'EQ-04 (lot 3) et maquettes des écrans, sans code. Trois manques relevés à l'API : les détails du paiement (ADR 0023), l'index des quinzaines, le relevé en retard d'une heure sur les rapports validés. Le code attend la fusion de #259 et des lots 3a à 3e.
- 2026-10-28 (fil Équipe) : Bilan tranche les trois manques (Équipe les écrit en ajout seul, il relit) ; le recalcul existait déjà dans le lot 3a. Extension relit les maquettes : la conception tient, 12 remarques corrigées dans la fiche et la galerie, puis son accord avec un dernier détail pris (le malus signé sur la ligne) (compteur et bouton absents quand c'est bloqué, « Valider » sur la ligne de sélection au téléphone, un seul état coché, une seule marque ambre, eyebrow du sous-onglet, un formateur signé, une grandeur par colonne dans Relevés, passé sur un relevé payé, aucune couleur nommée, `rp-notice` et `rp-account` dans `reports.css`).
- 2026-10-28 (fil Équipe) : l'API est dans main : les lots 3a à 3e d'EQ-04 (#271 à #275), l'alerte des taux (#276) et les ajouts d'EQ-05 (#279, migration 0031), dont un quatrième trouvé en codant Primes et malus, la lecture des saisies d'une quinzaine. La fiche le dit, ADR 0033 et 0035 acceptées, et la table des refus couvre tous les codes de `PAYROLL_ERROR_CODES`, dont `payment_before_period_unprocessable` et le refus d'un IBAN dans la référence, ajoutés à la relecture de #279 par Bilan.
- 2026-10-28 (fil Équipe) : écrans codés en local, sur les ajouts de l'API (lot `eq04-validation`) : Quinzaine, Relevé, Relevés, Primes et malus, Objectifs, « Ajuster » depuis un relevé, le minimum dans Réglages › Règles de paie et Commissions. 70 captures des vrais écrans sur données inventées (14 scènes, Nuit et Jour, 1 440 et 390 px, mouvement réduit). Reste : la PR, avec la relecture d'Extension (`apps/web`), qui relit aussi deux petites retouches de fichiers partagés (`SubNav`, `Dialog`).
- 2026-10-28 (fil Équipe) : écrans recalés sur l'API finale de #279 : les deux refus qui manquaient, le jour minimum et le refus d'un IBAN dans « Marquer payé » avant l'envoi, la quinzaine d'avant la première clôture (`beforeFirstClosing`), et la prévision d'objectif du chatteur à partir du pourcentage atteint. Captures refaites (80, 16 scènes), avec deux scènes de plus : « Marquer payé » refusé avant l'envoi et une quinzaine d'avant la première clôture.
- 2026-10-28 (fil Équipe) : relectures de #281. Bilan : le texte de `request_invalid` ne parle plus d'un motif. Extension : le pied d'un brouillon, « par WorldRemit » repris de `PAID_BY`, les formulaires occupés jusqu'à la relecture et le paiement fait ailleurs relu sans message, la clôture par l'îlot et l'arrêt gardé après une validation passée, le CSV sans formule et révoqué après une minute, la répartition sur `nv-split`, et ses trois « au choix » (zéro jamais négatif, focus sur « Garder », minimum présenté par le paragraphe des règles). Charles : les chatteurs sont payés par WorldRemit seul, d'où la migration 0033 (numéro de Bilan) et le contrat. Trouvé en route : la page Quinzaine sautait vers une autre quinzaine après le dernier paiement, sous la fenêtre ouverte.
- 2026-10-29 (recette du 28/10, constat Équipe G1) : une quinzaine que la paie n'a pas pu calculer (`blocked`, voir EQ-04) se dit en **rouge**, au-dessus des lignes et avant tout avis ambre : « Le calcul est bloqué : Théo n'a pas de taux pour cette quinzaine. Ajoute-lui un taux, le calcul reprendra seul. », que les chiffres sont ceux du dernier calcul réussi, et depuis quand ; « Ouvrir sa fiche » pour le propriétaire, « Le propriétaire doit lui ajouter un taux » pour un manager. Le haut dit « À verser au dernier calcul réussi » / « Plus à jour : le calcul est bloqué. », les montants passent en encre pâle, la puce d'état devient « Calcul bloqué » (`rp-chip--bad`, aussi dans Relevés), ni case ni « Valider » ni compteur. Le rouge et non l'ambre de « Ce qui bloque la validation » : ce n'est pas une validation à attendre, ce sont des chiffres faux tant que rien n'est fait (« le rouge reste pour les urgences », `reports.css`). Commissions (le relevé d'un membre) ne le montre pas encore.
- 2026-10-29 (suite G1) : Commissions dit au membre, en rouge au-dessus de son relevé, « Ton relevé n'est plus à jour : le calcul de la quinzaine est bloqué. », qu'il lui manque un taux (ou qu'il en manque un dans l'équipe, sans nom), que le propriétaire est prévenu dans sa paie et que le calcul reprendra seul ; montant en encre pâle, puce « Plus à jour ». Une quinzaine que son propre rapport bloque avant tout relevé dit « Ton relevé n'est pas encore calculé ». Ouvert : le bandeau de Paie › Quinzaine pour un rapport d'avant l'arrivée du membre (cas B2) dit encore « Ajoute-lui un taux », geste qui n'existe pas pour une quinzaine passée.
- 2026-10-29 (relecture de #307, Extension) : une quinzaine bloquée se dit en **ambre**, des deux côtés (Paie › Quinzaine et Commissions, puces « Calcul bloqué » et « Plus à jour » en `rp-chip--warn`) : rien ne s'y valide (la validation refait le calcul et refuse), ce n'est pas une urgence, et un rouge sur sa propre paie alarmerait un chatteur qui n'y peut rien. Le chapeau dit « Rien ne se valide pour l'instant : les relevés se recalculeront seuls une fois le blocage levé. », le bandeau garde « Le calcul est bloqué : … ». Le haut garde les mots de #294 (« Reste à envoyer », « À verser une fois validé ») suivis de « , au dernier calcul réussi ». Les classes `rp-chip--bad` et `rp-notice[data-tone='danger']` sont retirées. Cas B2 (relecture d'Équipe) : pour `commission_rate_missing_conflict`, le bandeau dit « Un rapport validé de Basile tombe sur une quinzaine où son taux n'a pas encore commencé. », que c'est une donnée d'avant le correctif du 28/10 qui se corrige dans la base (propriétaire) ou que le propriétaire est prévenu (manager), sans bouton « Ouvrir sa fiche » ni « Ouvrir les membres » ; le membre lit « Un de tes rapports validés tombe sur une quinzaine où ton taux n'a pas encore commencé. ». Les mentions « Ajoute-lui un taux » et « Ouvert : » ci-dessus sont remplacées par celle-ci.
- 2026-10-31 (fil Équipe, passe sur les fiches) : revue design (#322, #323) : Historique et Commissions comptent ce qui est dû comme Paie › Quinzaine (« reste à envoyer » = payable validé moins payé, report du membre = `carriedMinor`), et une quinzaine encore à valider dit la part qui reste à valider ; les dates disent « 1er » partout.
