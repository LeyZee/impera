# EQ-06 (écrans) Factures, dossier du prestataire et exports comptables à l'écran
Statut : todo (lot 8 de `EQ-06-self-billing-invoices.md`, même ID ; écrans pour Extension, quatre compléments d'API pour Équipe avant eux)
Phase : équipe (ADR 0023)
Dépend de : `EQ-06-self-billing-invoices.md` lots 1 à 7 (tous dans `main`), EQ-05 (écrans de paie), EQ-11 (coquille par rôle)
Branche : celle du fil qui la prend (Extension pour les écrans, Équipe pour l'API)

## Objectif
Tout ce que le lot 1 à 7 a mis dans l'API se fait depuis l'application, sans `curl` ni base : le chatteur remplit son dossier, accepte son contrat et son mandat, dépose ses pièces, lit, accepte ou conteste ses factures ; le propriétaire vérifie, attribue les régimes, tranche les contestations, voit chaque facture qui approche de son échéance, règle les comptes du comptable et télécharge les trois exports. Rien n'échoit en silence.

## Contexte à lire
`EQ-06-self-billing-invoices.md` (§ À faire, défauts du lot 1, notes de chaque lot), `apps/api/src/modules/payroll/README.md` (routes, refus, règles), `packages/contracts/src/invoices.ts` et `payroll.ts` (DTO, codes de refus), `docs/glossary.md` (« Facture », « Avoir », « Acceptation d'une facture », « Pièce du prestataire », « Versement bloqué », « Journal des achats », « Récapitulatif DAS2 », « Archive des pièces »), ADR 0023 (§ Factures), 0036, 0038, 0039, 0040, 0041, `docs/design/README.md` (§ Finition d'un écran), l'écran existant `apps/web/src/settings/billing/` et les écrans de paie `apps/web/src/screens/pay/`.

## Ce que l'écran attend du serveur

**Déjà dans l'API** (aucune règle à recalculer à l'écran) :
- Facture : `GET /v1/payroll/invoices/:id/pdf` (le fichier, `no-store`), `GET …/acceptance`, `POST …/accept`, `POST …/contest` (motif), `POST …/contest/refuse` (motif), `POST …/contest/uphold` (ajustements qui nomment le document, ADR 0039 ; `reissue` pour annuler et refacturer, ADR 0040).
- Relevé : `payoutBlock` (`documents_not_issued`, ou attestation de résidence de l'année du virement manquante, ADR 0041) et le refus `payout_blocked_conflict` au paiement.
- Dossier : `GET /v1/payroll/contractors/:memberId/file`, `PUT …/profile`, `POST …/profile/verify`, `PUT …/profile/prefix`, `POST …/regimes`, `POST …/documents?id&kind&issuedOn[&validUntil]` (octets du fichier), `GET …/documents/:documentId/file`, `POST …/documents/:documentId/review` ; `GET` et `POST /v1/payroll/contract-texts`, `POST …/:textId/accept` ; `GET` et `POST /v1/payroll/billing-regimes`, `POST …/:regimeId/validation`.
- Réglages › Facturation : `GET` et `PUT /v1/payroll/billing-settings`, `PUT …/accounts` (huit champs, chacun `null` tant que le comptable ne l'a pas donné ; 400 si la TVA due est un compte déductible ou si les deux journaux ont le même code), logos.
- Exports, propriétaire seul : `GET /v1/payroll/accounting/journal?from&to` et `…/das2?year` rendent du JSON dont `content` est le fichier en base64 ; `GET …/archive?from&to` rend le ZIP lui-même, en flux.

**À ajouter par Équipe avant les écrans** (une PR d'API, relue par Bilan) :
1. **La liste des documents** : `GET /v1/payroll/invoices?memberId&from&to`, aucune n'existe aujourd'hui. Pour chaque facture, facture rectificative et avoir : identifiant, sorte, numéro, quinzaine, jour d'émission, échéance, totaux, état d'acceptation et sa fin de délai, règlement (`paid`, `imputed` ou `compensated` avec son jour, sinon `null`, lot 7a) et `due` calculé par le serveur dans le fuseau de l'agence : `settled`, `open`, `soon` (non réglée, échéance dans sept jours au plus) ou `overdue`. Le propriétaire et un manager actif lisent tout, le chatteur les siens (politique de `invoices`).
2. **`remindFrom` par pièce** dans le dossier : le jour où le rappel commence (1er décembre de son année pour l'attestation de résidence, `validUntil` moins `documentReminderDays` pour la vigilance), annoncé au lot 5c-2 et reporté ici.
3. **L'alerte d'échéance** : un job quotidien publie une fois par facture `invoice_due_soon` à J-7 puis `invoice_overdue` le lendemain de l'échéance, tant qu'elle n'est pas réglée, sans nom de prestataire (« d'un prestataire » et le lien, règle de Charles). Elle lit les trois sortes de règlement du lot 7a (`paid`, `imputed`, `compensated` : une facture compensée n'attend plus rien) et dit quand c'est un versement bloqué (ADR 0041) qui approche des 60 jours, puisqu'il peut les dépasser et coûter les pénalités et l'indemnité de 40 €. Le rendu Telegram (important, ambre ; rouge pour `invoice_overdue`) revient au fil Telegram.
4. **Le délai de rappel des pièces** (`documentReminderDays`, lu par les réglages et le job de rappel, sans route d'écriture) dans `PUT /v1/payroll/billing-settings`. L'échéance (`dueDays`, 45 à 60 jours) y est déjà, et le délai de contestation se fixe dans chaque version du mandat.

**Côté contrats, avec les écrans** : `INVOICE_ERROR_CODES` reste à part de `PAYROLL_ERROR_CODES` (`packages/contracts`) ; l'écran les traduit dans son propre `switch` exhaustif, comme l'écran de paie le fait pour les siens.

## À faire (écrans)
- [ ] **Commissions › Mes factures** (chatteur) : ses documents, du plus récent ; numéro, quinzaine, total, état d'acceptation en mot, PDF. « J'accepte » ou « Je conteste » (motif obligatoire) tant que le délai court, avec sa fin ; un avoir suit la même acceptation. Le versement se lit sur le document (« versée le 3 novembre ») ; aucune échéance en couleur pour le chatteur.
- [ ] **Paie › Factures** (propriétaire, manager) : les documents par quinzaine ou par membre ; échéance en ambre à J-7 et en rouge une fois passée (`due`, jamais recalculé), jamais en silence ; contestations à trancher en tête (refuser avec motif, ou donner raison avec les ajustements qui nomment le document, ou annuler et refacturer) ; « Versement bloqué » avec sa raison sur le relevé.
- [ ] **Moi › Mon dossier** (chatteur) : nom, adresse, identifiant fiscal, et pour une société française forme, capital et ville du RCS ; contrat et mandat à accepter (version, texte entier, acceptation datée) ; pièces exigées par son régime, dépôt (PDF, JPEG ou PNG, 10 Mo au plus), état (en attente, acceptée, refusée avec son motif), rappel à partir de `remindFrom`. Pour un chatteur du Bénin, le guide de l'attestation de résidence (texte d'écran au § 4 de la recherche citée dans `EQ-06-self-billing-invoices.md`, hors dépôt) : le titre exact au guichet, gratuite, 72 heures, à refaire chaque janvier, l'IFU seul ne suffit pas.
- [ ] **Équipe › fiche du membre › Dossier** (propriétaire) : vérifier le dossier lu (`updatedAt`), fixer le préfixe, attribuer un régime à partir d'un jour (aujourd'hui au plus tôt), examiner chaque pièce une fois (accepter, ou refuser avec motif), jamais sur son propre dossier.
- [ ] **Réglages › Facturation** (propriétaire) : à côté de l'agence et du logo déjà faits, les régimes (création, jour de validation par le comptable noté une fois, jamais modifiés ; l'aide dit que le texte d'un régime ne répète pas ce que le code imprime déjà : badge « Autofacturation », mandat, catégorie de l'opération, TVA, échéance), les versions du contrat et du mandat, les comptes du journal (huit champs vides par défaut, aucun compte proposé ; le 422 de l'export nomme ceux qui manquent) et les délais.
- [ ] **Paie › Exports** (propriétaire) : le journal (période de 731 jours au plus ; le fichier est rendu tel quel depuis ses octets base64, ISO 8859-15, jamais relu comme texte ; groupes sans lettre et virements hors du fichier en ambre), la DAS2 (année ; les bénéficiaires en clair avec leurs avertissements en ambre et la note « montants partis » ; le CSV), l'archive (période ; téléchargement du flux en un fichier, le manifeste dit ce qu'elle n'a pas pu inclure).
- [ ] **Aujourd'hui** : pour le chatteur, la pièce à renouveler dès `remindFrom` et la facture à accepter ; pour le propriétaire, les factures `soon` et `overdue`, les pièces à examiner et les contestations à trancher.
- [ ] **Finition** (Charles, 27/10) : chaque écran passe `docs/design/README.md` § Finition d'un écran, captures Nuit et Jour, bureau et téléphone, mouvement réduit ; montants en euros, chiffres tabulaires, dates « 1er ».

## Critères d'acceptation
- Aucun écran ne recalcule une échéance, un état d'acceptation, un règlement, un blocage ni un montant : il lit ce que l'API rend.
- Chaque refus de l'API a sa phrase en français (codes de `invoices.ts` et `payroll.ts`), jamais un code brut.
- Un chatteur ne voit que ses documents et son dossier ; un manager ne voit ni les exports ni les comptes.
- Les fichiers téléchargés sont identiques, octet pour octet, à ceux que rend l'API (test sur le journal en ISO 8859-15).
- Équipe relit chaque écran EQ et chaque montant avant fusion.

## Hors périmètre
Coordonnées de paiement, transmission à une plateforme agréée, notifications sur téléphone (EQ-12), import d'Imperium (EQ-07).
