# 0047. Ranger le code qui a grossi : la paie en quatre modules, l'argent calculé par le seul serveur, l'assemblage par module, le dashboard par domaine

Statut : proposed (demande de Charles, 02/11/2026 17h25, fil « Visualiser l'architecture avec floorplan », après la lecture de la carte d'architecture du même jour)
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

- **Sens des dépendances, sans cycle** (ESLint `boundaries` et `docs/architecture/modules.md` mis à jour dans la même PR) : `contractors` ne dépend d'aucun des trois ; `payroll` dépend de `contractors` ; `invoicing` dépend de `payroll` et de `contractors` ; `accounting` dépend de `payroll`, `invoicing` et `contractors`. Chacun garde ses couches `domain/`, `application/`, `infra/` et n'est importé que par son `index.ts`.
- **Le seul lien à rebours** : un versement exige l'attestation acceptée de l'année (ADR 0041) et tous les documents émis (#363), donc une information de `invoicing`. `payroll` le demande par un **port** (`PayoutGate`) qu'il déclare dans son domaine ; l'assemblage (§ 3) le branche sur `invoicing` et `contractors`. Aucun import de `payroll` vers `invoicing`. **`PayoutGate` reçoit la transaction du versement** et l'implémentation de `invoicing` et `contractors` lit avec elle, sous le même verrou consultatif que l'écriture du versement, comme aujourd'hui : une annulation ou un avoir ne peut pas passer entre la vérification et le paiement. Un test d'intégration rejoue le cas concurrent (un avoir émis pendant un paiement).
- **Chaque table a un seul module propriétaire**, écrit dans la section « Tables possédées » du README du module : `commission_statements`, saisies, règles, reports, versements et taux à `payroll` ; `invoices` et `invoice_*` à `invoicing` ; `contractor_*`, régimes, pièces et attestations à `contractors` ; ce qui ne sert qu'aux exports à `accounting`. Un autre module lit ces données par l'`index.ts` du propriétaire, jamais par le `schema.<table>` de `@nirvana/db` : un test d'architecture (ou une règle ESLint) refuse qu'un module importe la table d'un autre.
- **Les jobs** : chaque nom de job, ceux de la crontab compris (`payroll.lock_payout_certificate`, `payroll.remind_documents`, `payroll.remind_due_invoices`, `payroll.requeue_invoice_issues`…), a **exactement un** gestionnaire après le découpage, enregistré par le `wiring/` du module qui le porte ; un test le vérifie. Un module qui met en file le job d'un autre (valider un relevé dans `payroll` met en file `payroll.issue_invoices` d'`invoicing`) passe par un port, jamais par le nom du job écrit en dur.
- **Ce qui ne bouge pas** : les tables, les politiques RLS et les migrations (aucune migration dans ce découpage) ; les noms des jobs Graphile (`payroll.issue_invoices`, `payroll.render_invoice_pdf`…), parce que des tâches déjà en file portent ces noms ; les routes HTTP (`/v1/payroll/...`) et les contrats de `@nirvana/contracts`, qui décrivent l'API et non les modules ; les codes d'erreur rendus au client et leur statut HTTP.
- **Zéro chiffre changé, vérifiable** : le **premier commit** de la PR, fait sur le code d'avant le déplacement, enregistre un fichier de référence : les `inputs_hash`, montants et numéros (relevés, factures, avoirs) des quinzaines de la fixture d'intégration, et la liste complète des codes d'erreur de la paie avec leur statut HTTP. Les commits suivants retrouvent ce fichier à l'identique. La PR ne modifie aucun test existant autrement que par ses chemins d'import, et passe la suite complète (unitaires et intégration Postgres).
- Les fichiers trop longs (`ports.ts`, `errors.ts`, `routes.ts`) se répartissent entre les quatre modules selon le métier de chaque port, erreur ou route.

### 2. L'argent se calcule au serveur, le dashboard l'affiche

- Le détail d'une quinzaine **et** la réponse que lisent les Commissions du chatteur rendent, en plus de ce qu'ils rendent déjà, un champ `summary` de même forme que la ligne de `GET /v1/payroll/periods`, calculé par le même code serveur ; pour le chatteur, il ne porte que ses propres chiffres.
- La prévision de fin de quinzaine (`forecastNetMinor`) et la part des rapports tardifs (`lateNetMinor`), toutes deux `nullable`, deviennent des champs calculés par le serveur à l'heure de la requête (horloge injectée, pour des tests déterministes), avec la règle actuelle du dashboard (le rythme du temps écoulé dans le fuseau de l'agence, les rapports tardifs comptés une fois, `null` avant un premier jour complet), et seulement sur les chiffres que le lecteur a le droit de voir (un chatteur ne reçoit jamais le net de l'équipe).
- `summaryOf`, `lateNetOf` et `forecastNet` sortent de `apps/web` ; le dashboard ne garde que des fonctions de présentation (libellés, pastilles, mise en forme des montants). Règle pour la suite : **une somme, une différence ou un pourcentage d'argent affiché se lit dans la réponse du serveur, jamais recalculé dans le navigateur.** Le passage d'un montant en texte reste au dashboard.

### 3. L'assemblage se fait module par module

- `apps/api/src/composition-root.ts` garde l'ordre d'assemblage et le partage des dépendances communes (base, journal, budget, horloge, gardes de route) ; chaque module a son fichier `apps/api/src/wiring/<module>.ts` qui construit ses services, ses routes et ses jobs à partir de ces dépendances et rend ce qu'il expose.
- Les deux entrées, l'API et le worker, passent par les mêmes fichiers `wiring/`.
- `wiring/` est un nouveau type d'élément pour `eslint-plugin-boundaries` : il importe l'`index.ts` des modules et les dépendances communes, et seul `composition-root.ts` l'importe.
- Aucun comportement ne change : mêmes routes, mêmes gardes, mêmes jobs, même ordre d'enregistrement.

### 4. Le dashboard se range par domaine

- Un dossier par entrée du rail (ADR 0024) sous `apps/web/src/` : `today/`, `dashboard/`, `tracking/`, `train/`, `creators/`, `team/` (membres, planning, rapports), `pay/` (paie, factures, prestataires, comptabilité), `settings/`, `me/` ; plus les dossiers communs `shell/`, `auth/`, `lib/`, `test/`. Chaque dossier tient ses pages, son `api.ts`, son `model.ts` et ses composants. `screens/` disparaît.
- Le déplacement est une PR de pur déplacement (`git mv` et chemins d'import), sans changement de code, faite à un moment où **aucune autre PR ouverte ne touche `apps/web`**, annoncée à l'avance aux fils Extension et Chantier 7. Les routes de l'application et les URL ne changent pas.

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
