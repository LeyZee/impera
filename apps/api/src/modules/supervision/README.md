# Module `supervision`

**Rôle.** Approbation des drafts, prise en main humaine, notifications (dashboard SSE, Web Push), interrupteurs d'arrêt, journal des décisions.

**Peut dépendre de.** conversations, fans ; payroll par un port branché par le composition root (`UsdRateView`, le dernier taux du dollar)

**Règles propres.** Propriétaire de `notifications` et `kill_switches`. Les décisions d'approbation sont des événements du journal des conversations (`draft_approved`, `draft_rejected`), pas une table. Réagit aux événements de l'outbox `domain_events` (`draft_created`) au lieu d'être appelé par `conversations`.

## Structure

- `domain/` : types, règles pures, machines d'état. Zéro I/O, zéro import de framework.
- `application/` : cas d'usage (commandes, requêtes, handlers de jobs). Orchestrent le domaine et les ports.
- `infra/` : implémentations (Drizzle, HTTP Fastify, jobs Graphile, clients externes).
- `index.ts` : **seule** porte d'entrée publique du module. Tout ce qui n'y est pas exporté est privé.

Voir `docs/architecture/modules.md` pour les règles communes et `docs/playbooks/add-a-module.md` pour en créer un.

## Tableau de bord

`GET /v1/dashboard` (`infra/http/dashboard-routes.ts`) lit ses agrégats dans une transaction tenant (`infra/views/dashboard-reader.ts`) ; le domaine (`domain/dashboard.ts`) en fait l'écran.

- **« À traiter » sur Arrêt** (choix de Charles, 28/10) : la liste garde toujours les lignes graves, les causes de passation qui touchent à la sécurité (`minor`, `non_consent`, `distress`, ensemble `GRAVE` de `todos`). Les autres lignes (brouillon à valider, envoi échoué, autres passations, « Sans réponse ») sont cachées tant que l'interrupteur de la créatrice ou l'interrupteur général est levé, et reviennent avec l'agent. Le filet « Sans réponse » se tait aussi quand Reveal n'est pas lu.
- **Meilleurs fans en euros** (choix de Charles, 28/10) : ce que chaque fan a payé sur la période, ventes en euros et en dollars. Ses dollars sont convertis au dernier taux BCE connu, celui de la paie (ADR 0033), lu par le port `UsdRateView` que le composition root branche sur `payroll.latestRate`, sous le contexte membre de qui lit le Dashboard. La conversion et le classement sont dans le domaine (`domain/fan-ranking.ts`) : sur le total de la période du fan, le tout et la part de l'agent arrondis une fois chacun, au centime le plus proche, le demi-centime s'éloignant de zéro, comme la paie, en entiers (`bigint`), jamais en flottants ; à égalité, l'ordre des identifiants. Sans taux connu, les dollars ne comptent pas : un fan qui n'a payé qu'en dollars sort du classement. `usdSales` dit à l'écran s'il y a eu une vente en dollars sur la période et le jour du taux, pour sa phrase discrète sous la liste. C'est un classement, jamais un versement.

## Mise en route (plan de pilotage W1)

`GET /v1/dashboard/setup/creators`, au propriétaire seul, et `GET /v1/dashboard/setup/members`, au propriétaire et à un manager actif qui n'y lit que les chatteurs, sans leur facturation (« ok manager mise en route », 12/11) : chaque étape est cochée par le serveur d'après la base (`domain/setup.ts`, règles pures et testées), jamais par un clic. La lecture (`infra/views/setup-reader.ts`) passe par la connexion admin, comme les comptes de Réglages › Sécurité : son compte à elle, les mots de passe, les passkeys et les liens d'extension sont hors de portée du rôle applicatif. Lecture seule, aucun message ni fan.

- **Créatrice** : compte plateforme relié, persona active, pourcentage de l'agence en vigueur, accès (invitation ouverte ; « en attente » tant que son lien vit ; à refaire, et dit, quand il a expiré sans être ouvert), règles de paie sur chacun de ses comptes, groupe Telegram qui reçoit ses alertes urgentes (couverture du module `telegram`, branchée par le composition root), heures de l'agent (les heures par défaut comptent comme faites et le disent), un shift non annulé qui finit dans les 14 derniers jours ou après, mode de l'agent hors Arrêt, dernière vérification de fiabilité de sa plateforme propre et faite sur des jours où son compte existait.
- **Membre** (pas parti) : invitation ouverte (mot de passe choisi ; expirée sans être ouverte, à refaire), double authentification (code ou passkey), et pour un chatteur seulement extension reliée, compte chatteur de la plateforme relié, créatrices confiées (les archivées ne comptent pas), un shift posé (sur une créatrice non archivée). Un manager n'a que l'invitation, la double authentification et ses créatrices. Tout membre payé (un chatteur ; un manager dont un taux ou une part du net de l'équipe est en vigueur) a en dernier « Sa facturation » : ce qui empêcherait sa première facture de partir aujourd’hui, la raison même que donnerait la validation du 16, ou, sous un régime à convention, son versement sans l’attestation de résidence de l’année (`invoicing` › `invoiceReadiness`, branché par le composition root, supervision ne lit aucune table de facturation).
