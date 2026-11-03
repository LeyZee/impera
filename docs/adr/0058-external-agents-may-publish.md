# 0058. Un agent externe peut préparer et publier le contenu public de la créatrice, et seulement lui

Statut : proposed (demande de Charles du 03/11/2026, 9 h 53 : « j'aimerais bien que Grok ou qu'un autre agent […] puisse se connecter à notre appli, à Nirvana, pour faire des actions concrètes et pouvoir publier, prendre les médias, les publier » ; fil « Repenser le workflow médias et scripts de la modèle »). **Amende l'ADR 0026, acceptée** : à accepter par Charles avec les mots exacts de la dérogation ci-dessous.
Date : 2026-11-03
Remplace : dans l'ADR 0026 § 5, la règle « **un agent connecté peut freiner, jamais accélérer** » devient « un agent connecté peut freiner, jamais accélérer, **sauf pour préparer et publier le contenu public de la créatrice, dans les limites de l'ADR 0058** ». Tout le reste de l'ADR 0026 reste tel quel.
Précise : l'ADR 0057 (§ 8), l'ADR 0055 (catégories), l'ADR 0044 § 3 (plan de la semaine).

## La dérogation, mot pour mot

> Par dérogation à l'ADR 0026 § 5, un agent connecté par le MCP peut, si le propriétaire lui accorde le droit pour une créatrice, ajouter ou modifier une publication dans le plan de diffusion de cette créatrice, et, avec un second droit, la publier lui-même dans un plafond par jour et par sortie fixé par le propriétaire. Cette dérogation ne vaut que pour les sorties publiques : feed Reveal, story Reveal, Instagram et canal Telegram. Elle ne vaut jamais pour un fan, un Mass DM, un script, un prix, une offre ni une proposition de chatting.

## Contexte

L'ADR 0026 a ouvert Nirvana aux agents externes (Grok, ChatGPT, Claude) par le MCP, en lecture, avec des écritures qui freinent seulement. Sa règle protège les fans : rien d'écrit par un agent externe ne doit atteindre un fan, et aucun agent ne doit ouvrir l'Automatique par une porte dérobée.

Le 03/11, Charles veut qu'un agent externe puisse aussi faire des actions concrètes, dont prendre les médias déposés et les publier. Publier en public au nom de la créatrice, c'est accélérer : il faut une décision qui le dise.

Le risque n'est pas le même que pour un fan. Une publication ratée est publique, donc visible tout de suite, et se retire (à la main pour Instagram, ADR 0057). Un message à un fan, un prix ou un âge confirmé ne se rattrapent pas. La dérogation suit cette frontière.

## Décision

### 1. Deux capacités nouvelles

| Capacité | Outils | Ce qu'elle permet |
|---|---|---|
| `write:publication_plan` | `publishable_drops_list`, `publication_plan_get`, `publication_upsert`, `publication_remove` | Lister les dépôts publiables d'une créatrice (catégorie, description validée, date, état ; jamais le fichier ni son adresse, ADR 0026 § 4) ; ajouter ou modifier une publication du plan (quel dépôt, légende, heure, visibilité) ; retirer une publication pas encore partie. Un humain accepte la semaine comme pour toute publication (ADR 0044 § 3). |
| `publish` | `publication_publish` | Publier une publication du plan sans attendre l'acceptation de la semaine, dans le plafond. Exige `write:publication_plan`. |

- **Une modification par un agent fait revenir la publication à « à accepter »**, même si sa semaine avait été acceptée : rien ne part avec un texte ou un média d'agent qu'un humain n'a pas vu, sauf si l'accès a aussi `publish` et que le plafond du jour le permet.
- **La visibilité** qu'un agent peut régler est une liste fermée qui ne contient **aucune valeur payante** (une publication à débloquer est un prix) ; le schéma Zod de l'outil refuse toute autre valeur.
- Les deux sont accordées accès par accès par le propriétaire, jamais cochées d'office, comme `read:conversation_content` (ADR 0026 § 4). L'écran dit en une phrase ce qu'elles ouvrent.
- **Plafond** : un nombre de publications par jour et par sortie, fixé par le propriétaire sur l'accès ; au-delà, l'outil refuse. Par défaut : zéro (rien ne part tant qu'il n'est pas fixé).
- **Interrupteurs** : un par accès et un global, « Publication par agent », dans Réglages ; le global est coupé par défaut et le couper arrête aussitôt toute publication par agent.

### 2. Le même chemin que le code

- Chaque outil appelle la commande exposée par le module propriétaire, comme une route (ADR 0026 § 1) : mêmes gardes, même clé d'idempotence (`idempotencyKey` obligatoire), même journal, avec `via: { grantId }`.
- Un dépôt ne part que vers la sortie de sa catégorie (ADR 0055 § 1) : l'agent ne peut pas envoyer une story Reveal sur Instagram.
- **L'accord de la créatrice pour Instagram** (ADR 0057 § 7) s'applique aussi à un agent : sans lui, la publication attend. Le droit `publish` ne le contourne jamais.
- La garde d'écriture de la plateforme (ADR 0018) et les quotas (ADR 0057 § 3) s'appliquent.

### 3. Ce qui reste fermé

La liste « Jamais exposé » de l'ADR 0026 § 5 reste entière. En particulier, et même avec ces droits, un agent externe ne peut jamais : écrire ou envoyer quoi que ce soit à un fan ; toucher un Mass DM (envoyé à des fans), un script, une étape, un prix, une offre, une proposition de chatting ; changer une catégorie ; lire ou télécharger un original ; supprimer un dépôt.

### 4. Le texte de l'agent

- Une légende écrite par un agent externe est une donnée. Elle passe par les mêmes gardes que celle du modèle de Nirvana : gardes de voix, garde Instagram (ADR 0057 § 6), longueur. Si elle ne passe pas, l'outil la refuse avec la raison ; Nirvana ne la réécrit pas pour l'agent.
- Les descriptions de médias que l'agent lit viennent du rôle `sense` et des humains : elles ne contiennent aucun texte de fan.

### 5. Ce que l'agence voit

- Chaque publication préparée ou publiée par un agent porte son nom dans le plan et dans Publié (« publiée par Grok, accès de Charles »). La créatrice ne voit jamais quel agent ni qu'une IA y a touché (ADR 0042).
- Chaque appel entre au journal (ADR 0026), avec la publication et la sortie.

### 6. Ordre

D'abord les connecteurs de l'ADR 0057, dans le CRM (le modèle de langage de Nirvana suffit sans agent externe). Puis `write:publication_plan`, après le lot 1 du MCP. Puis `publish`, seulement après deux semaines où les publications préparées par un agent ont été acceptées sans retouche notable, ce que le propriétaire juge sur l'historique du plan.

## Conséquences

Positives :
- Un agent externe (Grok, Claude, ChatGPT) peut faire tourner le contenu public de la créatrice, avec les mêmes gardes que le code.
- La protection des fans de l'ADR 0026 ne bouge pas.

Négatives, à surveiller :
- Un jeton d'agent volé peut publier, dans le plafond : plafond à zéro par défaut, interrupteur global, expiration de l'accès (90 jours au plus, ADR 0026), journal.
- Un agent externe manipulé (par un texte lu ailleurs) peut écrire une légende maladroite : les gardes la bloquent pour Instagram ; pour Reveal et Telegram, le droit `publish` reste réservé aux agents qui ont fait leurs preuves.

## Alternatives rejetées

- **Garder l'ADR 0026 telle quelle** (recommandation de la revue du 03/11, avant la demande de Charles) : le moteur du CRM publie seul et suffit, mais Charles veut qu'un agent externe agisse.
- **Ouvrir aussi les Mass DM** : un Mass DM arrive chez des fans ; c'est exactement ce que l'ADR 0026 protège.
- **Donner le fichier original à l'agent** : il choisit sur la description ; le fichier reste chez nous (ADR 0026 § 4).
