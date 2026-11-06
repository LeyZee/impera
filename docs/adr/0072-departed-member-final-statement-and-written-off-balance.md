# 0072. Paie : le relevé final d'un membre parti est celui de la quinzaine de son départ, et son solde négatif s'éteint

Statut : proposed (à accepter par Charles : « ok 0072 »)
Date : 2026-11-06
Amende : l'ADR 0039 § 6 (la quinzaine de clôture) ; précise l'ADR 0038 (« le dernier relevé d'un membre qui part verse tout ») et l'ADR 0023 (§ Les règles d'Imperium : le report négatif)

## Contexte

La recette du 05/11 (synthèse, questions 12 et 15) a relevé deux règles de la paie d'un membre parti qui n'avaient pas été choisies par Charles.

1. **Le relevé final est celui de la quinzaine qui suit le départ.** L'ADR 0039 § 6 garde ouverte, après la dernière quinzaine travaillée, une « quinzaine de clôture » sans activité. Elle sert à porter les corrections des contestations de la dernière facture, puisque cette facture naît à la validation de la quinzaine du départ. Le code lui donne un relevé même vide (`departure.ts`, `recalculation.ts`), et seuls les relevés à partir d'elle sont finaux : sans minimum de versement, tous les reports versés (ADR 0038). Le membre attend donc une quinzaine de plus pour toucher ses petits montants reportés, et il a un relevé vide sans raison.
2. **Un total négatif se reporte sans fin.** Un remboursement arrivé après le départ, ou un ajustement en faveur de l'agence, peut rendre négatif le total d'un relevé. Le report négatif d'Imperium n'a pas de limite (ADR 0038). Pour un membre qui ne travaille plus, il passe d'une quinzaine à la suivante pour toujours, et chaque quinzaine lui fait un relevé final de plus, négatif.

Charles a répondu le 06/11, en acceptant les recommandations qui suivent (« Je suis d'accord avec tout ») :

- 15 : « la quinzaine du départ, payée au cycle normal. Pas de quinzaine fantôme après son départ, et il voit tout de suite ce qu'il touche » ;
- 12 : « ramené à zéro, et l'écran refuse un ajustement qui ferait passer un membre parti en négatif. Tu ne courras jamais après quelques euros chez un freelance parti ».

## Décision

**1. Le relevé final est celui de la quinzaine qui contient le jour du départ.** Cette quinzaine est calculée, validée, facturée et versée au cycle normal. Son relevé est final : il ne tient pas compte du minimum de versement et il verse tous les reports (ADR 0038). Tout relevé du membre sur une quinzaine suivante est final aussi.

**2. Plus de relevé vide après le départ.** La quinzaine qui suit le départ n'a un relevé que si quelque chose y arrive : une correction de contestation (ADR 0039 § 3), une vente ou un remboursement enregistré après la validation de la quinzaine du départ, un ajustement. Ce relevé est final. Une correction va toujours sur la première quinzaine encore ouverte du membre (ADR 0039 § 6), qui peut être celle-là ou une plus tardive.

**3. Un relevé final attend que ses documents soient réglés.** Il ne se valide que quand aucun document du membre n'attend de réponse ou ne reste contesté, comme la quinzaine de clôture aujourd'hui (`keep_final_statement`). La contestation de la facture de la quinzaine du départ arrive après sa validation : sa correction donne un relevé sur la quinzaine suivante (point 2). Le filet de l'ADR 0039 § 6 reste donc, sans relevé fantôme.

**4. Le total négatif d'un relevé final est ramené à zéro.** Il ne se reporte plus : l'agence abandonne ce que le membre lui doit encore. Le relevé le montre sur une ligne à part, « Solde abandonné », avec le montant. Il ne verse rien, et son report sortant vaut zéro. Les avoirs que l'ADR 0036 émet pour les montants rendus restent émis comme aujourd'hui : ils disent ce qui a été trop versé. L'abandon est ce que l'agence décide de ne pas réclamer, et le journal d'audit le garde.

**5. Un ajustement qui rendrait négatif le total d'un membre parti est refusé.** La règle est dans le code, à l'écriture de l'ajustement, contre le brouillon de la quinzaine où il va : 409 avec le total qui resterait, et l'écran le dit avant l'envoi. Une correction de contestation « montant trop haut » (ADR 0039 § 3) suit la même règle : elle va jusqu'à zéro au plus. Un remboursement de plateforme n'est pas un ajustement et n'est jamais refusé : c'est le point 4 qui l'absorbe.

**6. Rien ne change pour un membre présent.** Son report négatif reste sans limite (ADR 0038), son minimum de versement et ses reports positifs gardent leurs règles. Aucun relevé validé n'est recalculé. La règle vaut pour les brouillons à partir de l'acceptation de cette ADR, avec une nouvelle version du moteur.

## Conséquences

- Base (migration attribuée à l'arrivée sur `main`) : `keep_final_statement` lit la quinzaine du départ au lieu de la suivante. Le relevé garde son abandon (`written_off_minor`, nul ou négatif, zéro hors relevé final).
- Contrat : `CommissionStatement.writtenOffMinor`, et le code du refus de l'ajustement.
- Moteur : `finalFor` part de la quinzaine du départ, la quinzaine de clôture ne force plus de relevé vide, un relevé final négatif est ramené à zéro avec son abandon. Nouvelle version du moteur, ce qui recalcule les brouillons.
- Écrans : la ligne « Solde abandonné » dans le relevé et dans la Paie, le refus de l'ajustement, et la phrase du départ dans la fiche d'un membre (« Son relevé final, celui de la quinzaine de son départ, lui verse tout… »).
- Question au comptable, à trancher avant la mise en service (EQ-17) : la forme de l'abandon de créance envers un prestataire parti (avoirs déjà émis, puis abandon), et son traitement comptable chez l'agence.

## Options écartées

- **Supprimer tout relevé après le départ.** Une contestation de la dernière facture n'aurait plus de quinzaine où être corrigée, et l'argent bougerait hors de la paie, ce que l'ADR 0039 exclut.
- **Garder la créance.** L'agence devrait réclamer quelques euros à un prestataire parti, souvent à l'étranger, et la paie produirait un relevé négatif chaque quinzaine pour toujours.
- **Interdire seulement l'ajustement, sans abandon.** Un remboursement de plateforme arrivé après le départ rendrait quand même le total négatif.
