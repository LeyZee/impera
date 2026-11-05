# 2026-11-05 · MOT-04 : garde bloquante paiement hors plateforme et prix hors offre

- Fiche : recette du 05/11, MOT-04, questions 1 et 4 (Charles, « go recos »).
- Fait : deux codes bloquants dans `GUARD_CODES`, avec leur libellé web. `off_platform_payment` bloque PayPal, Lydia, virement, IBAN, RIB, Revolut, Wise, crypto, carte cadeau…, même dans un refus, comme un contact. `price_outside_offer` bloque toute somme écrite dans une bulle (« 5 € », « 20 euros », « 15 balles », « $10 ») : le prix est porté par l'offre, jamais par ses mots. Seul un merci pour un pourboire passe. Les deux suivent le même chemin que les autres gardes, bulle par bulle puis message entier démasqué. Ils s'appliquent donc à la voix comme aux bulles retouchées par un chatteur (422 `draft_unprocessable`).
- Tests : `guards.test.ts` (cas bloqués et permis), `voice-guards.test.ts` (couverture des codes), approbation HTTP en intégration.
- Découvertes : la liste des interdits graves de l'ADR 0059 (alerte Telegram immédiate) ne contient pas `off_platform_payment`. À trancher quand la supervision sera codée, par une ADR qui modifie une phrase de 0059.
