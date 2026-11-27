# 2026-11-26 — Ménager les scripts : la pause après un achat (ADR 0128 § A) — done
Fait : `offerDecision` rend `after_purchase` pendant la pause qui suit son dernier achat (`limits.afterPurchaseHours`, persona `strategies.script_launch.after_purchase_hours` de 24 à 72 h, 48 h par défaut), levée pour ce message s'il sexualise de lui-même ou demande du contenu ; la pause n'arrête jamais l'étape suivante d'un script déjà ouvert ; pendant la pause elle n'ouvre pas la sexualisation d'elle-même (`afterPurchase`), elle le suit s'il y va. Dernier achat lu chez Reveal (`platformReads.lastPurchaseAt`, `lastPurchaseOf` : le lot payant acheté le plus récent, daté de son envoi) ; illisible, pas de pause. Playground : l'achat fictif ouvre la pause, testable avec « avancer ».
Pas fait : rejeu par variante (§ B, attend le test Reveal du § 13), alerte de stock (§ C).
Décisions : aucune nouvelle ; la pause compte depuis l'envoi du lot acheté (Reveal ne date pas l'achat), donc un peu plus courte qu'annoncé.
Découvertes : `situation.lastSpentAt` n'est rempli par aucun code de production (lu par `paysNow`).
Candidats à suppression : aucun.
Vérifié : tests unitaires de la politique, de la sexualisation, de `lastPurchaseOf`, du playground ; `pnpm check`.
