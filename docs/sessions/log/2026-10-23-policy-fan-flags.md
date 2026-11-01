# 2026-10-23 — Politique de vente : les drapeaux du fan passent avant tout (P3-02, PR 4a) — done

Fait : `offerDecision` reçoit `flags` (`FanFlags`) : « ne plus écrire », ventes gelées et âge non confirmé ferment l'offre, même quand le fan demande lui-même du payant. `maySulk(flags)` : jamais de bouderie sous ventes gelées, avec un fan fragile ou un fan à qui on n'écrit plus. Tests, `ai-engine.md`, fiches.

Pas fait : rien ne pose encore les drapeaux ni ne branche `offerDecision` (catalogue P6-01). Plafond de dépense : attend le prix des scripts.

Décisions : l'âge non confirmé ferme tout script, puisqu'un script Reveal est du contenu explicite ; les drapeaux ne se lèvent que par un humain ou la politique, jamais parce que le fan redemande.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`.
