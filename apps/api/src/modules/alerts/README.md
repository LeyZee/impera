# Module `alerts`

**Rôle.** Les alertes personnalisées de chaque créatrice (P4-01) : ce que le propriétaire écrit dans Réglages › Alertes (une phrase, des mots-clés, ou les deux ; « met en pause » ; diffusion Telegram), et ce que l'agent lira pour savoir quelles alertes surveiller.

**Peut dépendre de.** aucun module métier (feuille).

**Tables possédées.** `custom_alerts` et `system_alert_settings` (migration 0025), sous RLS par `creator_id`. Une alerte personnalisée a une ligne par créatrice ; les lignes écrites ensemble partagent `group_id`, et l'écran les montre comme une seule alerte. Pour le propriétaire, le module les parcourt dans une seule transaction en changeant `app.creator_id` (`enterCreator`, `SET LOCAL`), contre la liste des créatrices qui existent, lue d'abord dans `creators`. Une alerte retirée est archivée (`archived_at`), jamais supprimée : l'historique garde son nom. Une alerte système sans ligne est active ; `keyword` l'est toujours (ses mots sont ceux de sa persona, on les retire là), ce que la base vérifie aussi. L'historique des déclenchements et son « vu » (`alert_seen`) appartiennent à `conversations`, qui possède le journal ; `store.names(creatorId)` lui donne le nom de chaque alerte, archivées comprises.

**Routes** (montées sous `/v1`, contrat `packages/contracts/src/alerts.ts`, propriétaire seul) :

- `GET /alerts` : Réglages › Alertes. `custom` donne ses alertes non archivées, regroupées (`CustomAlertGroup` : chaque créatrice avec l'identifiant de sa ligne et son interrupteur) ; `system` donne les trois alertes système sur chaque créatrice, avec `locked` pour `keyword` ;
- `POST /alerts` : écrit l'alerte sur chacune de ses créatrices, sous le `groupId` choisi par le client (201). Le même envoi rejoue ce qui est stocké (200). Le même identifiant avec d'autres valeurs, ou une alerte archivée, donne 409 `custom_alert_conflict` ;
- deux alertes actives (allumées, non archivées) d'une même créatrice ne portent jamais le même nom, sans compter les majuscules, les accents ni les espaces autour (`customAlertNameKey`, Charles, 28/10). `POST` et `PUT` répondent 409 `custom_alert_name_conflict`, avec dans `details.creatorIds` les créatrices où le nom est pris, et n'écrivent rien. Une alerte éteinte ou archivée laisse son nom libre. La vérification et l'écriture se font sous un verrou transactionnel (`pg_advisory_xact_lock` sur `alerts.custom_alert_names`), si bien que deux créations simultanées du même nom n'en écrivent qu'une. L'archivage (`DELETE`) prend le même verrou : une modification et un archivage simultanés passent l'un après l'autre, et une modification ne ramène jamais une alerte archivée entre sa lecture et son écriture. Il n'y a pas d'index, donc pas de migration ;
- `PUT /alerts/:groupId` : remplace l'alerte sur toutes ses créatrices. Les lignes gardées sont mises à jour, une créatrice ajoutée reçoit une ligne (ou retrouve la sienne si elle avait été retirée), et une créatrice retirée voit sa ligne archivée ;
- `DELETE /alerts/:groupId` : archive toutes les lignes (204) ;
- `PUT /alerts/system/:code` : active ou désactive une alerte système pour les créatrices nommées, sans toucher les autres. Pour `keyword`, la réponse est 422 `system_alert_locked_unprocessable`.

Les codes d'erreur sont dans `ALERT_ERROR_CODES`, le sujet Telegram de chaque alerte dans `CUSTOM_ALERT_TOPIC` et `SYSTEM_ALERT_TOPICS`, et deux mots-clés sont « le même » selon `alertKeywordKey`, la lecture du moteur (`normalise`, partagé dans le contrat). Une créatrice qui n'existe pas donne 400 `alert_creator_invalid`, sans rien écrire. Un groupe sans ligne active donne 404 `custom_alert_not_found`. Chaque écriture ajoute une ligne `custom_alert.create`, `.update`, `.archive` ou `system_alert.update` dans `audit_log`.

**Pour l'agent.** `store.activeFor(creatorId)` rend ses alertes personnalisées allumées et non archivées ; `store.systemOn(creatorId)` rend ses alertes système actives. Les mots-clés se lisent en code, la phrase par le cerveau, qui rend des identifiants (fiche P4-01). Un déclenchement s'écrit `alert_triggered` quand l'alerte prévient seulement, ou `handoff_requested` avec son `trigger` quand elle met en pause, jamais les deux. Aucun des deux ne porte le texte du fan (ADR 0020).

## Structure

- `domain/` : le port `AlertStore`. Zéro I/O.
- `infra/db/` : les tables sous RLS, chaque ligne relue par le contrat.
- `infra/http/` : les routes.
