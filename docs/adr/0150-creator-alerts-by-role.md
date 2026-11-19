# 0150. Les alertes de chaque créatrice : l'équipe décide, dans sa fiche, qui reçoit quoi et ce qui est en sourdine

Statut : accepted (demande de Charles du 17/11/2026, 13 h 28 et 13 h 31, fil « Créer les alertes par créatrice » ; acceptée par Charles le 17/11/2026 à 14 h 39, « ok alertes »)
Date : 2026-11-17
Précise : P4-01 (Réglages › Alertes), ADR 0020 (notifications Telegram), ADR 0042 § 7 (notifications push), ADR 0091 (dépense IA), ADR 0128 § C (stock de scripts), ADR 0143 § 13 (note quand l'agent oriente vers un compte). S'insère dans la fiche créatrice à sept onglets (ADR 0149, 6e onglet « Alertes », `/creatrices?onglet=alertes&creatrice=<id>`) et prend le choix par sorte des notifications de la créatrice que lui confie l'ADR 0149 § 4. Ne remplace aucun ADR.

## Contexte

Charles a regardé l'onglet « Alertes » d'un outil concurrent : par modèle, une liste d'alertes, chacune assignée à quelqu'un ou mise en sourdine. Il veut la même chose chez nous, avec quatre alertes nommées :

1. plus aucun script à envoyer dans une conversation ;
2. une vente ou un achat détecté ;
3. plus de crédit pour faire tourner l'IA ;
4. une offre proposée au fan, en dehors des scripts.

Il a tranché le 17/11 : la fiche créatrice passe à sept onglets, dont **Alertes**. Cet onglet sert l'équipe qui gère le compte (propriétaire, manager, chatteur en shift) ; la créatrice ne le voit pas. Ses notifications à elle s'appellent **Notifications**, elle les règle elle-même dans son espace (Moi › Notifications), et l'agence n'y touche pas.

Ce qui existe déjà (relevé du 17/11) :

- **Réglages › Alertes** (propriétaire seul, P4-01) : ses alertes personnalisées (une phrase, des mots-clés, « met en pause ») et quatre alertes système allumées par créatrice : un mot de sa fiche (`keyword`, toujours actif), un service demandé (`service_request`), un doute sur la personne (`identity_doubt`), le prix d'une étape de script changé (`script_price`).
- **Réglages › Telegram** (ADR 0020) : quel groupe reçoit quel sujet (urgent, important, info, ventes, mots-clés, validations, ses alertes), par créatrice ou pour toutes.
- **Suivi › Historique des alertes** (la table `notifications` de supervision existe, mais aucun écran ne la lit : pas de cloche dans le CRM).
- **Notifications push** (ADR 0042 § 7) : par compte, avec heures calmes et plafond quotidien.
- **Événements** : `sale_detected`, `budget_threshold_crossed` (seuil d'alerte puis plafond, sans créatrice), `ai_credits_low`, `handoff_requested` (dont `custom_order`, `minor`, `distress`…), `alert_triggered`.

Ce qui manque :

- un routage **par rôle** : aujourd'hui une alerte va à un groupe Telegram, jamais « au manager » ou « au chatteur en shift sur elle » ;
- une vue **depuis la fiche** de la créatrice ;
- l'alerte « plus de script pour ce fan » : seul le stock d'ensemble existe (ADR 0128 § 15), qui avance la demande de script à la créatrice ;
- l'alerte « offre proposée » : la note de l'ADR 0143 § 13 n'est pas codée.

## Décision

### A. L'onglet Alertes de la fiche

1. **Une ligne par alerte de cette créatrice**, rangées en quatre familles : **Sécurité**, **Ventes**, **Conversation**, **Système**. Pour chaque ligne : son nom, une phrase qui dit quand elle part, et trois rôles (Propriétaire, Manager, Chatteur en shift), chacun sur **Reçoit**, **Sourdine** ou **Rien**.
   - **Reçoit** : une notification sur son téléphone, qui sonne, sous ses heures calmes et son plafond (ADR 0042 § 7).
   - **Sourdine** : la même notification, sans son ni vibration (précisé au lot 2 : le CRM n'a pas de cloche ; la notification muette en tient lieu).
   - **Rien** : rien pour ce rôle. L'historique des alertes garde toujours la ligne, quel que soit le réglage.
2. **« Chatteur en shift »** veut dire le ou les chatteurs dont le shift couvre cette créatrice au moment de l'alerte, lus dans le planning. Hors shift, un chatteur ne reçoit rien de cette créatrice.
3. **Qui voit l'onglet** : le propriétaire seul (ADR 0149). Le manager, le chatteur et la créatrice ne le voient pas ; ils reçoivent ce qui leur est routé. Le serveur refuse le rôle `creator` sur ces routes ; la table est fermée à la créatrice par la RLS.
4. **Réglages › Alertes reste** la vue de toutes les créatrices d'un coup, pour ses alertes personnalisées. L'onglet de la fiche montre les mêmes alertes, filtrées sur elle, et y ajoute le routage par rôle. Une alerte personnalisée créée depuis la fiche ne porte que cette créatrice.
5. **Telegram ne change pas** : c'est un canal de plus, réglé dans Réglages › Telegram. L'onglet le rappelle d'une ligne (« Aussi envoyé au groupe … ») sans le régler.

### B. Les alertes de l'onglet

| Famille | Alerte | Quand | Défaut (Propriétaire / Manager / Chatteur en shift) |
|---|---|---|---|
| Sécurité | Fan peut-être mineur, non-consentement, détresse, rencontre, manipulation | `handoff_requested` de ces causes | Reçoit / Reçoit / Reçoit, **verrouillé** |
| Sécurité | Doute sur la personne | `identity_doubt` | Reçoit / Sourdine / Reçoit |
| Ventes | Vente détectée | `sale_detected` | Reçoit / Sourdine / Sourdine |
| Ventes | Offre proposée (§ D) | `offer_proposed` | Reçoit / Reçoit / Reçoit |
| Ventes | Prix d'un script changé | `script_price` | Reçoit / Reçoit / Rien |
| Conversation | Plus de script pour ce fan (§ C) | `scripts_exhausted` | Reçoit / Reçoit / Sourdine |
| Conversation | Un mot de sa fiche, ses alertes personnalisées | `keyword`, `custom_alert` | Reçoit / Sourdine / Reçoit |
| Système | Budget IA : seuil d'alerte, plafond atteint, crédits bas | `budget_threshold_crossed`, `ai_credits_low` | Reçoit / Reçoit / Rien |
| Système | Session Reveal expirée | `session_state_changed` vers `expired` | Reçoit / Reçoit / Sourdine |

6. **Verrouillé** : les relais humains de sécurité (mineur possible, non-consentement, détresse, rencontre, manipulation) partent toujours au propriétaire et au chatteur en shift. On ne peut ni les mettre en sourdine, ni les couper. Ces règles priment sur tout réglage (ADR 0088, règle d'âge). « Toujours » vaut aussi la nuit : ces relais sonnent pendant les heures calmes de chacun et hors du plafond du jour, qu'ils ne consomment pas (raison `safety_alert`, relecture Sécurité du 19/11). Les autres alertes sonnent toute la journée hors du plafond du jour, et la nuit attendent le récapitulatif de la fin des heures calmes (décision de Charles, 19/11).
7. **Budget IA** : le budget est celui de l'agence, pas de la créatrice. Le seuil d'alerte et le plafond se règlent dans Réglages › Consommation IA ; l'onglet de chaque créatrice montre la ligne et son routage, et rappelle que l'IA s'arrête pour toutes quand le plafond est atteint. Un seuil franchi prévient une seule fois par jour et par rôle, pas une fois par créatrice.
8. **Sans ligne en base, le défaut du tableau s'applique.** Les défauts vivent dans le code (`domain/`), testés, jamais dans un prompt.

### C. « Plus de script pour ce fan »

9. **Quand** : l'agent voudrait ouvrir un script (la porte de l'ADR 0103 est ouverte, sa note de désir atteint le seuil, aucune pause ne s'applique) et **aucun script n'est jouable pour ce fan** : tous déjà achetés par lui, aucun rejeu possible (ADR 0128 § 8), aucun proposable. Le code publie `scripts_exhausted { conversationId }`.
10. **Une fois par épisode** : il ne repart pour ce fan que lorsqu'un script est redevenu jouable pour lui puis a de nouveau manqué. Un fan sans script n'est jamais relancé pour autant ; l'agent continue la relation.
11. **Lien avec le stock** : le stock d'ensemble (ADR 0128 § 15) ne change pas ; l'alerte dit seulement à l'équipe qu'**un** fan chaud attend, pour qu'un chatteur lui vende à la main ou que le propriétaire avance un script.

### D. « Offre proposée »

12. **Compte comme offre proposée**, tout ce qui se vend hors des scripts :
    - l'agent oriente un fan vers ce qu'elle propose autour de sa pratique (ADR 0143 § 10 : atelier, formation, séance privée, cours) ; c'est la note de l'ADR 0143 § 13, devenue un événement ;
    - le fan demande une commande sur mesure et la conversation passe à un humain (`handoff_requested` de cause `custom_order`, ADR 0090) ;
    - le fan demande un service (appel, cam, vocal, contenu perso) et l'alerte système `service_request` part.
13. **Ne compte pas** : une étape de script ou un média payant (c'est la Vente), un compte donné pour ses lives sans offre, une demande de rencontre (elle reste un relais de sécurité, § 6).
14. **Ce qu'elle porte** : `offer_proposed { conversationId, kind: practice_offer | custom_order | service_request, usage? }`. Jamais le texte du fan, jamais le nom d'un compte, jamais un prix : l'agent n'en fixe aucun (ADR 0143 § 11).

### E. Ce que l'alerte dit

15. Une notification dit le nom de la créatrice, l'alerte, et ouvre la conversation dans le CRM. Jamais le nom ou le pseudo du fan, jamais ce qu'il a écrit (ADR 0020).

### E bis. Les notifications de la créatrice

16 bis. **Les mots** : « Alertes » pour ce que l'agence surveille, « Notifications » pour ce que reçoit une personne sur son téléphone. Jamais l'un pour l'autre dans l'interface.
16 ter. **Dans /notifications** (page déjà ouverte à tous pour l'appareil, les heures calmes et le plafond), la créatrice choisit elle-même, par sorte, ce qu'elle reçoit : **demande de l'agence**, **semaine à valider**, **gains** (sa part d'une vente), **lives**. Chaque sorte est allumée par défaut. L'agence ne lit ni ne change ces choix ; ils ne touchent aucune alerte de l'équipe. Une table `notification_kind_preferences` (`user_id`, `kind`, `enabled`) sous RLS `own_rows`, chacun pour lui-même.

### F. Données et routes

16. **Table `creator_alert_routes`** (`creator_id`, `alert_code`, `role` parmi `owner`, `manager`, `chatter_on_shift`, `mode` parmi `deliver`, `muted`, `off`, `updated_by`, `updated_at`), unique sur (`creator_id`, `alert_code`, `role`). RLS forcée par `creator_id`, fermée à la créatrice, `GRANT SELECT TO impera_service`. Une alerte verrouillée refuse toute ligne autre que `deliver` (contrainte en base et en code).
17. **Routes** (contrat `packages/contracts/src/creator-alerts.ts`) : `GET /v1/creators/:id/alerts` (propriétaire seul) et `PUT /v1/creators/:id/alerts/:code` (propriétaire seul, idempotent : le même corps rejoue ce qui est stocké). Chaque écriture ajoute une ligne `creator_alert_route.update` dans `audit_log`. Tests : authentication-sweep, origin-sweep, isolation entre créatrices.
18. **Le routeur** (`alerts.route`, chaque minute) relit la dernière demi-heure de l'outbox `domain_events`, classe chaque événement en alerte (table du domaine), lit ses choix par la même règle que l'onglet (le verrou tient aussi à la lecture ; une lecture en échec donne les défauts, jamais « personne »), puis appelle `notify` du module `notifications` pour chaque compte des rôles atteints, une seule fois par compte (le plus fort de ses rôles). Deux raisons nouvelles entrent dans `NOTIFICATION_REASONS` : `creator_alert` pour les alertes ordinaires, `safety_alert` pour les relais de sécurité (§ 6). La clé d'unicité est l'événement et le compte : relire la fenêtre ne sonne jamais deux fois. Les relais de sécurité sont lus par une requête à eux, avant le reste ; le reste est lu page par page jusqu'au plus récent de la fenêtre, de sorte qu'une rafale n'en écarte jamais un. Un rôle illisible (shift, membres, managers) ou un compte en échec est journalisé et n'empêche pas les autres d'être prévenus.

### G. Qui code quoi

| Fil | Ce qu'il code |
|---|---|
| **Bilan** | Migration et contrat (§§ 16–17), routes et leurs balayages, le routeur (§ 18), la raison `creator_alert`. |
| **Agent** | `scripts_exhausted` (§§ 9–10) et `offer_proposed` (§§ 12–14), avec leurs tests et une éval de chaque. |
| **Design** | L'onglet Alertes de la fiche : familles, trois rôles par ligne, cadenas sur les alertes verrouillées, rappel Telegram. Aucun contrôle natif. |
| **Sécurité** | Relit les droits (§ 3) et le verrou (§ 6). |

Ordre : contrat et migration, puis routeur et événements d'Agent en parallèle, puis l'écran.

## Conséquences

Positives :
- Une alerte arrive à la personne qui peut agir, au moment où elle est en shift.
- Les quatre alertes demandées existent, chacune décidée par le code.
- La créatrice garde la main sur ses propres notifications, l'agence sur les siennes.

Négatives :
- Une migration et un routeur de plus à côté de Telegram.
- Deux endroits montrent ses alertes personnalisées (Réglages › Alertes et la fiche) ; ils lisent la même table.

## Alternatives rejetées

- **Laisser la créatrice régler les alertes de l'équipe** : ce n'est pas à elle de décider ce que l'agence surveille (Charles, 17/11).
- **Router seulement par groupe Telegram** : un groupe ne sait pas qui est en shift, et tout le monde n'y vit pas.
- **Compter chaque étape de script comme offre proposée** : du bruit ; la Vente le couvre déjà.
- **Une sourdine sur les alertes de sécurité** : une seule alerte manquée suffit à faire un drame.

## Décisions de Charles

1. 17/11/2026, 13 h 35 (carte de choix) : « offre proposée » = tout ce qui se vend hors des scripts, venant de l'IA ou du fan (§§ 12–13).
2. 19/11/2026, 17 h 26 (carte de choix) : les alertes de l'équipe autres que les relais de sécurité sonnent toute la journée hors du plafond de notifications du jour, et la nuit attendent le récapitulatif du matin (§ 6).
