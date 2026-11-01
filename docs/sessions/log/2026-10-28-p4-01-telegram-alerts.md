# 2026-10-28 — P4-01 Telegram : alertes personnalisées et système — done
Fait :
- `alert_triggered` remplace `keyword_matched` (qui n'a jamais eu de producteur) dans `SCANNED_EVENT_TYPES` et dans le déclencheur (migration 0027).
- Lecture (`infra/events.ts`) : l'alerte qui a sonné et la conversation, seulement si `notify` est vrai. Ni `matchedBy` ni le mot déclaré ne sont lus.
- Classement : une alerte qui prévient part dans le sujet du contrat (`CUSTOM_ALERT_TOPIC`, `SYSTEM_ALERT_TOPICS`), titre « Alerte », « Mot surveillé » ou « Important », sans fil à fermer, « L'agent continue de lui répondre ». Une remise de cause `keyword`, `custom_alert` ou `identity_doubt` part dans le sujet de l'alerte, avec `fallbackTopic: important` : le scan la donne aux groupes « Important » quand aucun groupe ne reçoit ce sujet. Elle se ferme comme toute remise.
- `conversations` (accord de Bilan, add-only) : `alert_triggered` dans `PUBLISHED` du journal, sinon l'événement restait dans `conversation_events` et le déclencheur ne le voyait jamais ; test d'intégration journal → `domain_events`.
- Réglages › Telegram : ligne « Alertes personnalisées » dans le routage de l'onglet Alertes (test : la ligne se voit, un groupe coché enregistre `topic: 'custom'`) ; « Dernières alertes » liste aussi ses alertes.
- Docs : ADR 0020 § 3 (ligne de l'événement), README du module, fiche P4-01 (Réglages › Telegram garde le routage).
Pas fait : `notify` dans le contrat, porté par Agent en B2 ; d'ici là, une ligne sans `notify` n'est pas envoyée.
Décisions : repli sur « Important » pour un fan mis en pause quand le sujet de son alerte n'a pas de groupe, pour qu'il ne reste pas sans humain.
Découvertes : `docs/sessions/LOG.md` est figé, une session n'y ajoute plus de ligne.
Candidats à suppression : aucun.
Vérifié : pnpm check, tests unitaires du module (33), intégration telegram, conversations et de bout en bout sur Postgres 16 (36), `settings/telegram` (34).
