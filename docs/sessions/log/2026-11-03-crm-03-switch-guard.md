# 2026-11-03 — CRM-03 : la garde de bascule — done
Fait :
- `detected` n'est plus refusé d'office. `POST /v1/team/pay-rules` l'accepte pour un compte d'une plateforme qui donne un net (Reveal), auquel un modèle de la plateforme est relié, quand la dernière vérification de la plateforme (CRM-02) est un `match` propre sur une quinzaine entière qui finit avant la quinzaine des règles.
- Un refus garde le code `pay_rules_source_conflict` (409) et dit pourquoi dans `details.reason` (`PAY_RULES_SOURCE_REFUSALS` dans `pay-rules.ts`).
- `connectors` donne les faits (`salesFeedSwitchReads.switchFactsOf`, lus dans la transaction des règles) ; `scheduling` décide (`assertSourceSwitchable`, pur) ; `wiring/scheduling.ts` relie les deux.
- Relecture Équipe : « propre » (`isCleanMatch`) exige aussi que la vérification ait été faite après la fin de sa quinzaine, dans le fuseau de la plateforme. La route refusait déjà des jours non terminés (`sales_feed_check_days_unprocessable`) ; la définition le tient désormais elle-même, pour l'écran CRM-02 comme pour la garde. Le lien de modèle est lu sur la plateforme du compte.
Pas fait : le message web par raison (Extension, noté dans la fiche).
Décisions :
- Seule la dernière vérification de la plateforme compte, comme `GET …/check` : une vérification plus récente qui ne concorde pas retire l'accord d'une plus ancienne.
- La quinzaine vérifiée finit avant la quinzaine des règles : le net a concordé avant de payer (ADR 0050 § 8).
- La garde n'est pas un réglage : elle tient en code, et la bascule reste un geste du propriétaire.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié :
- `pay-rules.test.ts` : 9 tests, dont 6 pour la garde ; `reliability-check.test.ts` : 15 tests, dont la vérification faite pendant sa quinzaine (5 novembre) et la borne de minuit à Paris.
- `scheduling-reports.integration.test.ts` : 23 tests, dont la bascule de bout en bout par l'API (modèle non relié, aucune vérification, dernière vérification non propre, puis 201).
