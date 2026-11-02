# 0050. Reveal à deux voies : l'API CRM officielle pour les ventes et les chiffres, la session capturée pour tout le reste

Statut : accepted (Charles, 02/11/2026, « ok 0050 », après lecture de l'avis du même jour, fil « Évaluer l'API CRM de Reveal face à l'extension » ; § 8 : « ok netAmount », le même jour ; § 10 : « je valide l'option 3 », le même jour)
Date : 2026-11-02
Complète : l'ADR 0008, dont la phrase « attendre une API officielle : il n'y en aura pas » est dépassée pour les ventes et les chiffres ; sa stratégie reste celle de tout le reste.
Remplace : dans l'ADR 0018, l'alternative rejetée « un second port », pour les seules ventes et les seuls chiffres ; dans l'ADR 0043 § 4, la phrase « une vente de la fenêtre sans attribution envoie le rapport au valideur » ; dans l'ADR 0043 § 5, la phrase « le rapport reste dû pour le commentaire, l'incident, les remontées et le contrôle ».
Précise : l'ADR 0023 (source « détectée » et, pour elle seule, le début de la chaîne de calcul), l'ADR 0025 et l'ADR 0049 (l'auteur Reveal d'une vente), l'ADR 0043 § 5.

## Contexte

Le 02/11, Charles a découvert dans le dashboard de Reveal une page Paramètres › CRM / API et sa documentation. L'API, authentifiée par une clé d'agence (`x-api-key`), révocable et limitable à certaines modèles, donne :

- les statistiques par modèle et par jour, et par chatteur, par modèle et par jour ;
- les fiches des modèles et l'équipe ;
- le registre des ventes et des remboursements, un par un, avec le fan et le chatteur, lu par un curseur qui ne périme pas ;
- les mêmes ventes poussées par webhook signé, en 10 à 30 secondes, ouvert par le support agence par agence.

La documentation dit aussi ce qu'elle ne fait pas : la clé ne peut « ni lire les conversations » ni rien modifier d'autre que ses webhooks. Aucune route ne couvre la boîte de réception, les messages, l'envoi, les scripts, les notes, le coffre, le feed ou l'envoi de Mass DM.

Cette ADR s'appuie sur la seule documentation : aucune clé n'existe encore, aucun appel réel n'a été fait. Les CGU de Reveal restent à lire (ADR 0008). La documentation cite aussi « les bots des clés d'API » : une autre sorte de clé existe peut-être, sans preuve à ce jour ; Charles décide de poser la question au support.

## Décision

1. **Deux voies.** Ventes, statistiques, modèles et équipe se lisent par l'API CRM. Conversations, envois, scripts, notes, coffre, feed et Mass DM restent sur la session capturée (ADR 0008). L'extension garde ses fonctions. Si Reveal ouvre une API de messagerie, une nouvelle ADR rouvrira l'ADR 0008.

2. **Un second port, `PlatformSalesFeed`**, séparé de `PlatformConnector` : lecture par curseur stocké des ventes et des remboursements, statistiques, équipe, avec des capacités déclarées. Il fonctionne sans session. `PlatformConnector` impose `listConversations` et `sendText`, qu'un adaptateur à clé ne peut pas fournir, et la clé n'a ni la portée ni la durée de vie d'une session : l'argument de l'ADR 0018 contre un second port ne vaut donc pas ici. Le cœur ne voit aucune forme Reveal (ADR 0003). `listTransactions` n'est pas branché sur cette source : sa lecture par date perdrait une vente confirmée tard (après un 3-D Secure), que Reveal enregistre après des ventes plus récentes.

3. **Fiabilité.** Le curseur de `/v1/sales` est lu une fois par minute pour commencer. Les webhooks s'ajoutent ensuite : signature vérifiée, `t` refusé au-delà de 5 minutes, lecture par curseur gardée une fois par heure pour le rattrapage. Une vente est unique en base sur `sale.id` et `event`, et un webhook rejoué n'a aucun effet. Des schémas Zod lisent chaque réponse ; une valeur de `type` ou de `status` inconnue, dont Reveal prévient qu'elle peut s'ajouter, passe en `other` et se signale. Un `429` respecte `Retry-After`. Un `401` ou un `403` arrête la lecture et alerte le propriétaire, sans toucher à la voie capturée.

4. **La clé.** Le propriétaire la saisit dans le dashboard, sur le modèle de l'ADR 0016 : chiffrée en base, jamais dans le chat, le dépôt ou un log. Une clé par usage, avec le plus petit périmètre utile. Le pseudo et l'identifiant du fan qu'elle donne suivent les règles des données de fans : hors du dépôt, des fixtures et des logs.

5. **Attribution.** `chatterId` est « l'auteur Reveal » de l'ADR 0025. Une vente portant le membre « bot » revient à l'agent, sans commission. Avec plusieurs membres en poste, l'ADR 0049 s'applique dès que les fans sont confiés ; avant, `chatterId` fait foi. Une vente attribuée à un membre qui n'est pas en poste passe au valideur.

6. **Contrôle du rapport (ADR 0043 § 4).** Le rapport se compare à `amountTtc` des ventes attribuées au membre. Seuls les `ppv`, `tip` et `paid_message` sans chatteur envoient le rapport au valideur. Les autres ventes sans chatteur (abonnements, renouvellements, liens de paiement, boudoir, Mass DM) n'appartiennent à aucun shift : sinon presque chaque shift en aurait une, et la validation automatique ne se déclencherait jamais. Le contrôle repasse à l'arrivée d'une vente tardive ou d'un remboursement.

7. **Remboursements.** `sale_refunded` retranche les montants de la vente. S'il arrive après la validation d'un relevé, il passe par la mécanique existante (ADR 0032, 0036), sans jamais rouvrir le relevé. `refund_asked` compte encore, et se signale.

8. **Le calcul des montants se fait par plateforme** (Charles, « ok netAmount », puis son message du même jour : « un système de calcul par plateforme »). Chaque plateforme a ses commissions et ses règles : la façon d'obtenir la base d'une vente dépend donc de la plateforme.

   - **Reveal, en source « détectée »** : la base est `netAmount`, soit `agencyRevenue` + `modelRevenue`, une fois retirés la TVA selon le fan, la commission de Reveal et les frais de paiement. Nirvana ne calcule ni TVA ni commission de plateforme.
   - **Les autres plateformes** : notre chaîne (brut, euros, hors TVA, net de la commission, ADR 0023) reste, paramétrée par plateforme.
   - **Un compte en source « déclarée »**, Reveal compris tant qu'il n'a pas basculé : la chaîne de l'ADR 0023 reste entière, puisque la plateforme ne donne alors aucun net.
   - **Partout**, Nirvana garde le reste de la paie : taux de chaque chatteur, paliers, objectif collectif, primes, malus, report, relevés et factures.

   **Vérification avant toute bascule.** Aucun compte ne passe en « détecté » avant que Charles ait vu, sur une quinzaine passée couverte par le registre : la somme des `netAmount` face à l'export du dashboard et à `/v1/stats/daily`, qui doivent concorder au centime, et les commissions de chaque chatteur calculées sur `netAmount` face à celles de la chaîne de l'ADR 0023, avec l'écart expliqué. La bascule se fait ensuite à une frontière de période (ADR 0023).

9. **Tests.** `FakeReveal` gagne l'API CRM : curseur, vente tardive, remboursement, webhook rejoué ou mal signé, `429`, `401`. Aucun appel au vrai Reveal sans la demande de Charles.

10. **Sur Reveal, ventes automatiques et mini feedback** (Charles, « je valide l'option 3 »). L'API sait ce qui a été vendu, pas ce qui s'est passé.

    - **Une fois le compte passé en source « détectée »**, le chatteur ne saisit plus de vente et ne déclare plus de montant. Son téléphone montre ses ventes lues chez Reveal, sa commission estimée et son palier (ADR 0043 § 7, sans « + Vente »).
    - **Le mini feedback** (`shift_feedback`) remplace pour ce compte le rapport de fin de shift : à la fin du shift, le chatteur voit ses ventes déjà remplies, en lecture seule, et ajoute un commentaire, un incident ou une remontée (mêmes catégories que l'ADR 0043 § 2), ou touche « rien à signaler ». Il ne porte aucun montant et personne n'a à le valider.
    - **La paie ne dépend pas de lui** : elle lit les ventes de Reveal, attribuées selon le § 5. Un feedback manquant se rappelle au chatteur et n'enlève ou ne bloque aucun montant.
    - **Il n'y a plus de rapprochement ni de validation automatique pour ce compte**, puisque plus rien n'est déclaré. Restent deux signaux au manager en poste ou au propriétaire : une vente attribuée à un membre qui n'est pas en poste, et une vente `ppv`, `tip` ou `paid_message` sans chatteur. Ils remplacent l'envoi au valideur des §§ 5 et 6 pour ce compte. Le § 6 ne s'applique plus qu'au temps de la transition, si un compte Reveal a encore des ventes saisies alors que ses ventes sont lues.
    - **Jusqu'à la bascule, et sur les autres plateformes**, l'ADR 0043 s'applique telle quelle : ventes saisies, rapport, contrôle.

## Conséquences

Positives :
- La lecture des ventes, CR-09, `sale_detected` et le CA du Dashboard ne dépendent plus de la capture, et la source est officielle.
- Une session expirée n'arrête plus la lecture des ventes.
- La paie détectée part d'un montant réel, sans taux à tenir à jour.
- Sur Reveal, le chatteur ne saisit plus rien et ne peut plus déclarer un montant faux ; il garde 10 secondes de feedback pour ce que l'API ne sait pas.
- La capture a moins à prouver : le registre répond à la question des ventes et de leur auteur.

Négatives, à surveiller :
- Deux voies et deux secrets à surveiller.
- Un feedback sans conséquence sur la paie peut être négligé : le taux de réponse est à suivre, et le rappel à revoir s'il ne suffit pas.
- `netAmount` retire aussi les frais de paiement : à taux égal, une commission peut baisser par rapport à la chaîne de l'ADR 0023, d'où la comparaison du § 8.
- La voie capturée garde tout son risque, et Reveal a maintenant un canal officiel qui en exclut volontairement les conversations : les CGU sont à lire avant toute écriture réelle.
- Le registre ne remonte qu'à 31 jours avant son ouverture ; pour plus ancien, l'export du dashboard ou les statistiques par jour.
- L'API ne donne les messages que par jour : le signal de rush heure par heure de l'ADR 0049 reste lié à la capture, comme le feed et les Mass DM (ADR 0044) et les retours de l'IA (ADR 0043 § 6).
- Une vente ne porte ni conversation, ni message, ni bundle : le nom du pack dans une alerte et l'entonnoir par bundle restent liés à la capture.
- À vérifier au premier appel réel : que `memberId` et le fan de la session capturée sont le même identifiant, et que le membre « bot » remonte sous son propre `chatterId`.

## Alternatives rejetées

- **Tout passer par l'API** : impossible, elle ne lit pas les conversations et n'envoie rien.
- **Ignorer l'API et tout capturer** : un risque inutile pour des données officielles.
- **Greffer l'API sur `PlatformConnector`** : des méthodes obligatoires impossibles à fournir, et une lecture par date qui perd des ventes.
