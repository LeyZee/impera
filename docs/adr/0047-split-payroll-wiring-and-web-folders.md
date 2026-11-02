# 0047. Ranger le code qui a grossi : la paie en quatre modules, l'argent calculé par le seul serveur, l'assemblage par module, le dashboard par domaine

Statut : accepted (Charles, 02/11/2026 17h29, « ok 0047 », après la relecture de Bilan intégrée ; amendée après les relectures d'Équipe et d'Extension, phrases soumises à Charles avant fusion ; demande du même jour à 17h25, fil « Visualiser l'architecture avec floorplan », après la lecture de la carte d'architecture)
Date : 2026-11-02
Précise : l'ADR 0002 (modules et frontières) pour le découpage de `payroll` ; ne change aucune règle de paie, de facture ou de droit d'accès.

## Contexte

La carte d'architecture du 02/11 (Floorplan, hors dépôt) et une mesure rapide ont montré quatre points :

1. **Le module `payroll` porte quatre métiers.** 120 fichiers et 17 700 lignes hors tests, plus que `agent`, `conversations` et `connectors` réunis (9 800). On y trouve le calcul des commissions (saisies, règles, recalcul, relevés, validation, versements, taux BCE), les factures et avoirs (émission, PDF, acceptation, contestation, rectificative, échéances), le dossier des prestataires (identité, contrat, mandat, régimes, pièces, attestations, rappels, purge) et les exports comptables (journal, FEC, DAS2, archive). `domain/ports.ts` fait 787 lignes, `domain/errors.ts` 660, `infra/routes.ts` 763. Un changement de facture oblige à lire le module entier, et la frontière entre ces métiers n'est vérifiée par rien.
2. **Le dashboard refait des sommes d'argent.** `GET /v1/payroll/periods` rend déjà, par quinzaine, les comptes et les sommes (`netMinor`, `payableMinor`, `validatedPayableMinor`, `carriedMinor`, `paidMinor` ; `PayPeriodSummarySchema`). Mais l'écran d'une quinzaine et les Commissions du chatteur les recalculent à partir des relevés (`summaryOf` dans `apps/web/src/payroll/model.ts`), et la prévision de fin de quinzaine (`forecastNet`, `lateNetOf`) n'existe que dans le navigateur. Le jour où le serveur change une règle de somme, la liste et l'écran d'une quinzaine ne diront plus le même chiffre.
3. **`composition-root.ts` assemble tout dans un seul fichier** (891 lignes, 88 mentions de la paie). Chaque nouveau module l'allonge, et deux fils qui ajoutent chacun un module s'y marchent dessus.
4. **Le dashboard suit deux rangements.** Des dossiers par domaine (`payroll/`, `invoices/`, `accounting/`, `contractors/`, `reports/`, `scheduling/`, `creators/`, `agent/`, `settings/`) qui portent l'`api.ts` et le `model.ts`, et un dossier `screens/` (`pay/`, `team/`, `planning/`, `tracking/`…) qui porte les pages. Le code d'un même écran vit dans deux arbres.

## Décision

### 1. La paie devient quatre modules

| Module | Ce qu'il porte |
|---|---|
| `payroll` | Commissions : saisies et règles de paie, recalcul, relevés, validation, clôture, reports, versements, taux BCE, quinzaines. |
| `invoicing` | Factures et avoirs : émission, rendu PDF/A et copies, acceptation, contestation, annulation et rectificative, échéances. |
| `contractors` | Dossier du prestataire : identité, société, contrat et mandat, régimes, pièces et leur vérification, attestations de résidence, rappels, purge des pièces refusées. |
| `accounting` | Exports pour le comptable : journal, FEC, DAS2, archive ZIP. |

- **Sens des dépendances, sans cycle** (ESLint `boundaries` et `docs/architecture/modules.md` mis à jour dans la même PR) : `contractors` n'importe aucun des trois ; `payroll` importe `contractors` ; `invoicing` importe `payroll` et `contractors` ; `accounting` importe `payroll`, `invoicing` et `contractors`. Chacun garde ses couches `domain/`, `application/`, `infra/` et n'est importé que par son `index.ts`.
- **Les liens à rebours passent tous par des ports branchés à l'assemblage** (§ 3), jamais par un import. Le code d'aujourd'hui en compte plusieurs :
  - `payroll` déclare **`PayoutGate`** : il dit si un versement peut partir (attestation acceptée de l'année, ADR 0041 ; documents émis, #363) et combien de documents restent ouverts sur le relevé final d'un membre parti (`commission_statement_documents_open_conflict`, ADR 0039 § 6). Il est branché sur `invoicing` et `contractors`.
  - `payroll` déclare **`AfterValidation`** : la validation d'un relevé et le versement mettent en file l'émission des factures, le règlement des documents et le verrou des attestations (aujourd'hui `enqueueInvoiceIssue`, `enqueueDocumentSettle`, `enqueuePayoutCertificateLock` appelés depuis `validation-store.ts` et `entry-store.ts`). Il est branché sur `invoicing` et `contractors`.
  - `contractors` déclare **`InvoiceRequeue`** : corriger un dossier, un régime ou les réglages de facturation relance l'émission (aujourd'hui `enqueueInvoiceIssue` et `enqueueInvoiceRequeue` depuis `contractor-store.ts`, `regime-store.ts`, `billing-settings-store.ts`). Il est branché sur `invoicing`.
  - **Chaque port reçoit la transaction en cours** et l'implémentation lit et écrit avec elle, sous les mêmes verrous consultatifs qu'aujourd'hui : jamais un relevé validé sans son job d'émission, jamais un dossier corrigé sans sa relance, jamais une annulation ou un avoir entre la vérification d'un versement et son écriture. Pas de bus d'événements hors transaction. Un test d'intégration rejoue le cas concurrent d'un avoir émis pendant un paiement.
  - La règle de conservation d'un document (dix ans après la clôture de l'exercice, ADR 0037), lue aujourd'hui par `domain/documents.ts` dans `domain/invoice-pdf.ts`, passe dans le domaine de `contractors`, que `invoicing` importe.
  - `domain/billing.ts` se coupe : la part dossier (régimes, pièces, `taxResidenceOf`, `identityComplete`) va à `contractors`, `issueDecision` à `invoicing`.
- **Chaque table a un seul module propriétaire**, écrit dans la section « Tables possédées » du README du module : `commission_statements`, saisies, règles, reports, versements et taux à `payroll` ; `invoices` et `invoice_*` à `invoicing` ; `contractor_*`, régimes, pièces et attestations à `contractors` ; ce qui ne sert qu'aux exports à `accounting`. Un autre module lit ces données par l'`index.ts` du propriétaire, jamais par le `schema.<table>` de `@nirvana/db` : un test d'architecture (ou une règle ESLint) refuse qu'un module importe la table d'un autre.
- **Les jobs** : chaque nom de job, ceux de la crontab compris (`payroll.lock_payout_certificate`, `payroll.remind_documents`, `payroll.remind_due_invoices`, `payroll.requeue_invoice_issues`…), a **exactement un** gestionnaire après le découpage, enregistré par le `wiring/` du module qui le porte ; un test le vérifie. Un module qui met en file le job d'un autre (valider un relevé dans `payroll` met en file `payroll.issue_invoices` d'`invoicing`) passe par un port, jamais par le nom du job écrit en dur.
- **Ce qui ne bouge pas** : les tables, les politiques RLS et les migrations (aucune migration dans ce découpage) ; les noms des jobs Graphile (`payroll.issue_invoices`, `payroll.render_invoice_pdf`…), parce que des tâches déjà en file portent ces noms ; les routes HTTP (`/v1/payroll/...`) et les contrats de `@nirvana/contracts`, qui décrivent l'API et non les modules ; les codes d'erreur rendus au client et leur statut HTTP.
- **Zéro chiffre changé, vérifiable** : le **premier commit** de la PR, fait sur `main` avant le déplacement, enregistre un fichier de référence : les `inputs_hash`, montants et numéros (relevés, factures, avoirs) des quinzaines de la fixture d'intégration, et la liste complète des codes d'erreur de la paie avec leur statut HTTP. Les commits suivants, et toutes les PR du § 1, retrouvent ce fichier à l'identique. La PR ne modifie aucun test existant autrement que par ses chemins d'import, et passe la suite complète (unitaires et intégration Postgres).
- Les fichiers trop longs (`ports.ts`, `errors.ts`, `routes.ts`) se répartissent entre les quatre modules selon le métier de chaque port, erreur ou route.

### 2. L'argent se calcule au serveur, le dashboard l'affiche

- Le détail d'une quinzaine **et** la réponse que lisent les Commissions du chatteur rendent, en plus de ce qu'ils rendent déjà, un champ `summary` de même forme que la ligne de `GET /v1/payroll/periods`, calculé par le même code serveur ; pour le chatteur, il ne porte que ses propres chiffres.
- La prévision de fin de quinzaine (`forecastNetMinor`) et la part des rapports tardifs (`lateNetMinor`), toutes deux `nullable`, deviennent des champs calculés par le serveur à l'heure de la requête (horloge injectée, pour des tests déterministes), avec la règle actuelle du dashboard (le rythme du temps écoulé dans le fuseau de l'agence, les rapports tardifs comptés une fois, `null` avant un premier jour complet), et seulement sur les chiffres que le lecteur a le droit de voir (un chatteur ne reçoit jamais le net de l'équipe).
- L'objectif d'équipe se lit aussi au serveur : le pourcentage atteint (aujourd'hui `goalReachedBps` et `reachedBpsOf`, qui refont le plancher du moteur) et sa prévision (`forecastReachedBps`). **Une seule prévision par objectif**, calculée pour tous avec les rapports tardifs mis à part, et rendue au chatteur sans le net de l'équipe. Aujourd'hui, les Commissions du chatteur extrapolent le pourcentage sans mettre à part les rapports tardifs, et diffèrent de l'agence dès qu'il y en a un : **c'est le seul chiffre affiché qui change**, une prévision, jamais une paie.
- Le net de l'équipe d'une quinzaine (aujourd'hui `teamNetOf`) se lit dans `summary.netMinor`.
- `summaryOf`, `lateNetOf`, `forecastNet`, `teamNetOf`, `goalReachedBps` et `reachedBpsOf` sortent de `apps/web`. **Règle pour la suite : un montant d'argent affiché, une somme ou une différence de montants, et tout pourcentage qui décide d'un palier ou d'une prime se lisent dans la réponse du serveur, jamais recalculés dans le navigateur.** Restent au dashboard les seuls rapports d'affichage entre montants déjà rendus par le serveur, qui ne décident de rien : l'évolution d'une quinzaine à l'autre (`changeBps`) et les parts d'un graphique (`salesSplit`). La mise en forme des montants reste au dashboard.
- **Une seule source pour les sommes** : la liste calcule ses sommes en SQL. Un test vérifie, pour chaque quinzaine de la fixture et chaque lecteur (propriétaire, manager actif, chatteur), que `summary` est égal à la ligne de la liste ; et, avant de retirer `summaryOf`, qu'il donne les mêmes sommes que le serveur.

### 3. L'assemblage se fait module par module

- `apps/api/src/composition-root.ts` garde l'ordre d'assemblage et le partage des dépendances communes (base, journal, budget, horloge, gardes de route) ; chaque module a son fichier `apps/api/src/wiring/<module>.ts` qui construit ses services, ses routes et ses jobs à partir de ces dépendances et rend ce qu'il expose.
- Les deux entrées, l'API et le worker, passent par les mêmes fichiers `wiring/`.
- `wiring/` est un nouveau type d'élément pour `eslint-plugin-boundaries` : il importe l'`index.ts` des modules et les dépendances communes, et seul `composition-root.ts` l'importe.
- Aucun comportement ne change : mêmes routes, mêmes gardes, mêmes jobs, même ordre d'enregistrement.

### 4. Le dashboard se range : les pages par entrée du rail, les données par domaine

- **Les pages par entrée du rail** (les onze de `ITEMS` dans `shell/nav.ts`, ADR 0024) : `dashboard/`, `today/`, `tracking/`, `train/`, `planning/`, `commissions/`, `team/`, `pay/`, `creators/`, `settings/`, `me/`. Chaque dossier tient les pages et les composants de son entrée.
- **Les données par domaine de l'API** : `apps/web/src/domain/<payroll|invoices|contractors|accounting|reports|scheduling|creators|agent|settings>/`, avec l'`api.ts`, le `model.ts` et les composants partagés par plusieurs entrées (une bonne partie de ce code sert plusieurs entrées : `invoices/`, `reports/`, `scheduling/` sont lus par presque toutes).
- **Les communs** : `shell/`, `auth/`, `lib/`, `test/`. `screens/` disparaît.
- **Une règle vérifiée par ESLint** (des éléments `boundaries` internes à `apps/web`, ajoutés dans la même PR) : une entrée importe `domain/`, `shell/` et `lib/`, jamais une autre entrée ; `domain/` n'importe jamais une entrée.
- Le déplacement est une PR de pur déplacement, sans changement de code, en deux commits (les `git mv` seuls, puis les chemins d'import, pour que `git log --follow` garde l'historique de chaque fichier), faite à un moment où **aucune autre PR ouverte ne touche `apps/web`**, annoncée à l'avance aux fils Extension et Chantier 7. Les routes de l'application et les URL ne changent pas.

### Ordre et relectures

Une PR par point, dans cet ordre : § 2 (Équipe pour les montants, Bilan pour le contrat), § 3 (Bilan), § 1 (Équipe et Bilan, après § 3 parce que l'assemblage de la paie y change de forme), § 4 (Extension, après les lots en cours du chantier 7 sur le planning). Chacune passe `pnpm check` et `pnpm test:all` sans test retiré ni affaibli.

## Conséquences

- Un changement de facture, de dossier ou d'export ne touche plus qu'un module de taille raisonnable, et ESLint refuse une dépendance qui irait dans le mauvais sens.
- La liste des quinzaines, l'écran d'une quinzaine et les Commissions du chatteur ne peuvent plus diverger sur un montant.
- Ajouter un module n'allonge plus `composition-root.ts` que d'une ligne.
- On trouve le code d'un écran à un seul endroit.
- Coût : quatre PR de déplacement qui créent des conflits avec toute branche ouverte sur les mêmes fichiers, d'où l'ordre ci-dessus et l'annonce aux fils concernés. Les noms de jobs `payroll.*` restent même pour ce qui relève désormais de `invoicing` ou `contractors` ; c'est voulu.

## Hors de cette décision

- Découper les pages de plus de 1 000 lignes (`PeriodPage`, `ReportsPage`, `PlanningPage`, `TelegramSection`, la persona) : à faire écran par écran, par le fil qui les retouche.
- Brancher Reveal (capture, connecteur réel, extension) : priorité suivante décidée par Charles le 02/11, hors de ce rangement.
