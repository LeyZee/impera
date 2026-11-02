# 0051. Un second point d'entrée, pur, pour les règles qu'un module prête aux domaines qui en dépendent

Statut : proposed (relue par Bilan le 02/11/2026, trois précisions intégrées : domaine d'un autre module inatteignable, interdits externes du domaine sur `pure.ts`, réexportations seules)
Date : 2026-11-02
Précise : l'ADR 0002 (un module n'expose que son `index.ts`) et `docs/architecture/modules.md` (« `domain/` importe : `packages/contracts`, d'autres fichiers de `domain/`. Rien d'autre. ») pour les règles pures partagées entre modules ; rend possible le découpage de l'ADR 0047 § 1 sans changer de test.

## Contexte

L'ADR 0047 § 1 coupe `payroll` en quatre modules : `contractors` en bas, puis `payroll`, `invoicing`, `accounting`. Avant de déplacer le premier fichier, l'inventaire des imports du dossier `domain/` d'aujourd'hui montre que des règles pures passent d'un futur module à l'autre :

- `domain/payouts.ts` (le versement, `payroll`) appelle `regimeOn`, `taxResidenceOf` et `treatyNeedsResidence`, qui vont au domaine de `contractors` (ADR 0047 : « la part dossier (régimes, pièces, `taxResidenceOf`, `identityComplete`) va à `contractors` ») ;
- `domain/invoicing.ts` (l'émission, `invoicing`) appelle `identityComplete` et lit `ContractorDocument`, `ContractorIdentity`, `RegimeAssignment` ; `domain/invoices.ts` appelle `addDays` (dossier) et `rounding.ts` (paie) ;
- la règle de conservation d'un document (dix ans après la clôture de l'exercice, ADR 0037) passe au domaine de `contractors`, « que `invoicing` importe » (ADR 0047) ;
- `domain/journal.ts` et `domain/accounting.ts` (`accounting`) lisent `settlements.ts`, `invoices.ts` et `ContractorIdentity`.

Les règles d'aujourd'hui ne permettent aucun de ces imports : un `domain/` n'importe que son propre `domain/` et `@nirvana/contracts`, et un autre module ne s'atteint que par son `index.ts`, qui construit le module et importe donc son `infra/` (Drizzle, S3, pdfkit). Importer l'`index.ts` de `contractors` depuis le domaine de `payroll` ferait entrer ces dépendances dans un domaine qui doit rester sans I/O. L'ADR 0047 demande aussi que le découpage ne change aucun test autrement que par ses chemins d'import : on ne peut donc pas réécrire ces fonctions pour qu'elles reçoivent un résultat déjà calculé.

## Décision

- **Chaque module peut avoir un second point d'entrée, `pure.ts`, à sa racine, à côté d'`index.ts`.** Il ne contient que des réexportations (`export { … } from './domain/…'` et `export type { … } from './domain/…'`) de types, de fonctions pures, de constantes et de classes d'erreur de son propre `domain/` ; aucune fonction, constante ou classe n'y est écrite. Il n'importe que son `domain/` et `@nirvana/contracts`, et il a les mêmes interdits externes que le domaine : ni paquet npm, ni `node:` sauf `node:crypto`.
- **Le `domain/`, l'`application/` et l'`infra/` d'un module peuvent importer le `pure.ts` des modules dont il dépend** dans `MODULE_DEPENDENCIES`, et seulement ceux-là. Le sens des dépendances ne change pas : `contractors` n'importe aucun des trois autres, `payroll` peut lire `contractors/pure.ts`, et ainsi de suite (ADR 0047 § 1). Aucun cycle.
- **`index.ts` reste l'entrée de tout le reste** : la fabrique du module, ses ports, les types de son API. Il peut réexporter ce que `pure.ts` expose, pour qu'`application/` et `infra/` n'aient pas à choisir.
- **Le reste d'un autre module reste inatteignable** : ni son `domain/`, ni son `application/`, ni son `infra/` ne s'importent directement, seulement son `pure.ts` et son `index.ts` (ce dernier hors `domain/`).
- **ESLint le vérifie**, dans `eslint.config.js` :
  - `pure.ts` devient une couche du module (`pure: 'pure.ts'` dans `LAYERS`), autorisée vers son propre `domain/` et `@nirvana/contracts` seulement ;
  - le `pure.ts` des modules de `MODULE_DEPENDENCIES` s'ajoute aux cibles permises de `domain/`, `application/`, `infra/` et `index.ts`, générées comme les autres ;
  - le bloc qui refuse au `domain/` les paquets npm et `node:` (`external(...)`) vise aussi `pure.ts` ;
  - `no-restricted-syntax`, appliqué à `apps/api/src/modules/*/pure.ts`, y refuse toute instruction autre qu'une réexportation (`ExportNamedDeclaration` avec `source`, ou `ExportAllDeclaration` vers `./domain/`).
  - `apps/api/src/__tests__/boundaries.test.ts` prouve sur des fixtures que sont refusés :
    - un `pure.ts` qui importe son `infra/` ou un paquet npm ;
    - un `pure.ts` qui écrit une fonction ;
    - un domaine qui importe le `pure.ts` d'un module hors de sa liste ;
    - un domaine qui importe directement un fichier du `domain/` d'un autre module ;
    - un domaine qui importe l'`index.ts` d'un autre module.
  - Les cycles restent interdits par `MODULE_DEPENDENCIES`, déjà acyclique, et par `import-x/no-cycle` : `pure.ts` suit le même graphe qu'`index.ts`.
- `docs/architecture/modules.md` et `docs/playbooks/add-a-module.md` disent la règle dans la PR qui crée le premier `pure.ts` (celle de `contractors`, ADR 0047 § 1).

## Alternatives écartées

- **Laisser un domaine importer l'`index.ts` d'un autre module** : le domaine tirerait l'`infra/` de l'autre module, ses tests unitaires chargeraient Drizzle et le client S3, et la règle « zéro I/O » ne serait plus vérifiable.
- **Passer aux fonctions de domaine des faits déjà calculés** (la résidence fiscale, l'identité complète) : change leur signature et leurs tests, ce que l'ADR 0047 interdit pendant le découpage.
- **Un paquet de règles partagées (`packages/payroll-rules`)** : ferait la même chose avec un paquet de plus, et sortirait la part dossier de son module, ce que l'ADR 0047 refuse.
- **Mettre ces règles dans `@nirvana/contracts`** : ce paquet décrit l'API et les données échangées, pas les règles métier ; l'ADR 0047 place la part dossier dans le domaine de `contractors`.
- **Garder la part dossier dans `payroll`** : contredit l'ADR 0047 § 1.

## Conséquences

- Un module expose deux portes au lieu d'une ; la seconde est pure et vérifiée par ESLint.
- Les fichiers de domaine déplacés par l'ADR 0047 § 1 gardent leur code et leurs tests ; seuls les chemins d'import changent.
- Rien ne change pour les modules qui n'ont pas de `pure.ts`.
