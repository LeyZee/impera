# 2026-10-28 — EQ-05 : ce que l'API de la paie ajoute pour les écrans — done
Fait :
- Détails du paiement (migration 0031) : `paid_on`, `payment_method`, `payment_reference` et `sent_minor` sur `commission_statements`, remplis ensemble si et seulement si le relevé est payé. `keep_commission_statement` est réécrite par `CREATE OR REPLACE` sans toucher 0028 ni 0029, et le droit `UPDATE` ne s'étend qu'à ces quatre colonnes. `POST …/pay` prend `{ revision, paidOn, method, reference?, sentMinor }` (`PAYMENT_METHODS`, `assertPayment`), et le relevé lu porte `payment`. Contrats : `payment_in_future_unprocessable`, `payment_amount_unprocessable` et `calendarDayAt` exporté.
- `GET /v1/payroll/periods?limit=&cursor=` (`PayPeriodPageSchema`) : les quinzaines où le lecteur lit un relevé, de la plus récente à la plus ancienne. Pour chacune, la clôture, le nombre de relevés par statut et de reports, le net, l'à-verser et le versé, tout calculé en SQL sous `withMember`. Les sommes sont lues en texte puis refusées hors des entiers exacts de JavaScript. Un membre ne lit que la date d'une clôture, et `GET /v1/payroll/periods/:period` s'aligne : pour lui, `closedBy` et `exchangeRates` de la clôture valent `null` (un test le montre sur une clôture qui fige un taux du dollar). Ajout de `cursor_invalid` dans les codes de la paie. La garde de `GET /v1/payroll/exchange-rates` (propriétaire et manager actif, fermé par défaut), écrite ici d'abord, est entrée dans `main` avec le lot 3d (#274), sur une remarque de Bilan.
- `GET /v1/payroll/entries?period=` (`PayrollEntriesSchema`), quatrième ajout, trouvé en codant Primes et malus : les primes, les malus qui couvrent la quinzaine et les ajustements, annulés compris, en une lecture sous `withMember`. Un malus couvre une quinzaine selon `penaltyCovers`, et y compte selon `penaltyApplies`, qui s'appuie dessus ; le moteur et la route lisent les mêmes malus (`penaltiesSpanning`). Un membre ne lit pas les auteurs, ni dans cette liste ni dans les relevés de `GET /v1/payroll/periods/:period` : une seule fonction, `redactAuthors`, sert les deux routes. Au-delà de 500 saisies d'une sorte, `payroll_entries_too_many_unprocessable`. Le test d'intégration lit avec quatre comptes, et montre un malus annulé à partir de la quinzaine suivante qui compte encore dans la sienne.
- Un test montre qu'une rafale de validations de rapports donne un seul recalcul de la quinzaine, et qu'une validation refusée n'en met aucun en file. Le recalcul lui-même existait déjà (lot 3a).
- Le glossaire gagne « Paiement d'un relevé » ; `data-model.md`, `modules.md` et le README du module suivent.

Pas fait : les écrans d'EQ-05, dans la PR suivante (relecture d'Extension aussi).

Décisions (Bilan, 28/10) :
- Équipe écrit ces ajouts en ajout seul et Bilan relit ; la migration 0031 revient à Équipe. La 0030 (l'alerte des taux, #276) entre avant elle : Drizzle ne joue jamais une migration plus ancienne que la dernière appliquée.
- Un montant envoyé différent de l'à-verser est refusé, défaut posé en attendant Charles.
- Les moyens de paiement par défaut sont virement, Wise, PayPal et autre.
- Les sommes de l'index se calculent en SQL sous RLS, en `bigint` contrôlé, et un membre ne lit jamais de la clôture que sa date, dans l'index comme dans la quinzaine.
- La lecture des saisies : une route par quinzaine, sans pagination mais avec un plafond explicite par liste, les auteurs à `null` pour un membre dans les saisies comme dans les relevés, la règle de couverture dans le domaine, partagée avec le moteur, jamais recopiée en SQL (Bilan).
- Une manager active lit les relevés de l'équipe comme le propriétaire, puisqu'elle valide ceux des autres (ADR 0023) ; le changer demanderait une ADR.
- Un membre garde `rateMicros` sur les lignes de son propre relevé : sa paie doit être vérifiable par celui qui est payé (autofacturation). Le dernier taux lu reste à l'agence.
- Relecture de Bilan sur #279, toutes prises : un relevé sous zéro reporte aussi son total (report négatif), donc `carried` compte tout report non nul, et le test le montre avec un ajustement qui reprend plus que le net ; le jour du paiement n'est jamais avant le premier jour de la quinzaine du relevé (`payment_before_period_unprocessable`), parce qu'une faute d'année resterait figée sur un relevé payé (la borne n'est pas la validation : l'argent peut partir avant) ; la migration 0031 dit qu'une base où le lot 3c a déjà payé un relevé la refuse et se recrée, sans rattrapage inventé.
- La référence d'un paiement ne contient jamais d'IBAN (question posée à Bilan, réponse oui) : le contrat la refuse quand un passage du texte, gardé à ses lettres et chiffres, commence par un code pays, en a exactement la longueur et passe la clé mod 97 (`containsIban`). La liste des pays est le registre ISO 13616 plus les formats nationaux hors registre (zones UEMOA et CEMAC, dont le Bénin, où la plupart des chatteurs sont payés). L'écran et le serveur appliquent la même règle.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié :
- `pnpm check` ✓ et `pnpm test` ✓.
- Intégration ✓ : api (payroll, shift-reports et scheduling, dont `payroll-periods.integration.test.ts` et `payroll-entries-list.integration.test.ts` : propriétaire, manager et deux chatteurs sur les mêmes données) et db 17 (`payroll-rls`, `payroll-closing`).
- `pnpm --filter @nirvana/db drift` ✓.
