# 2026-11-06 — Harnais d'isolation : corps valides pour le dossier prestataire

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, point 3 de la suite de l'audit des tests d'isolation (06/11), d'après la relecture d'Équipe de #588 (`/mnt/project-files/recette/2026-11-06/equipe/relecture-588.md`, § 2)

## Fait

- `tenant-isolation.integration.test.ts` :
  - `PUT /v1/payroll/contractors/:memberId/profile` reçoit un profil valide (données inventées) ;
  - `POST /v1/payroll/contractors/:memberId/documents` reçoit sa vraie forme de requête (`REQUESTS`) : sa query (`id`, `kind`, `issuedOn`), `application/octet-stream`, et les premiers octets d'un PDF ;
  - les deux routes atteignaient le contrôle de la créatrice, mais seulement d'après le journal de la relecture d'Équipe. C'est maintenant le harnais qui le prouve.
- Nouvelle garde dans le même test : une route à qui le harnais donne un corps ou une requête valide et qui répond 400 le fait échouer (`invalid`). Un corps devenu invalide après un changement de contrat ne passe donc plus en silence, alors qu'il ne prouverait plus rien.
- `origin-sweep.integration.test.ts` : la réponse est lue comme JSON seulement quand c'en est. Une réponse non JSON nomme sa route au lieu de lever une erreur (remarque facultative d'Agent sur #598).

## Reste

- L'estimation d'un rapport (`?amountMinor=12300`, URL à part) quand #591 est sur `main`.
- Un chatteur de A en shift ouvert (`accessClock`) quand #593 est sur `main`.
- La séparation de l'éval du nightly (« nightly vert »).

## Découvertes

- Aucune.
