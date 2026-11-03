# 2026-11-03 — ADR 0059 : les écarts de persona sur Telegram — proposed
Fait :
- ADR 0059 proposée. Les interdits graves partent sur Telegram tout de suite : explicite avant l'âge et promesse de rencontre en `urgent` ; aveu d'IA, coordonnées, urgence inventée, mensonge sur un paiement et demande de photos intimes en `important`. Les autres rouges vont au bilan du soir des écarts, qui donne des comptes par règle, jamais un nom de chatteur ni de fan.
- Nouvel événement `persona_slip_flagged`. Le bilan du soir des écarts est entré au glossaire et l'index des ADR est à jour.
Pas fait : le code, qui viendra après la capture Reveal (ADR 0052 § 8). Le rendu Telegram reviendra au fil Telegram.
Décisions :
- Une seule alerte par conversation, par règle et par shift.
- Pas de nom de chatteur dans le groupe : le lien ouvre le Suivi.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`.
