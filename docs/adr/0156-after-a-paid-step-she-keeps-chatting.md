# 0156. Après une étape payante, elle continue de chatter : achat, refus, oubli, paiement, relances

Statut : accepted (« ok 0156 » de Charles le 20/11/2026 à 14 h 28, heure de Paris ; audit « Trous de l'IA de chatting » du 20/11/2026 ; demande de Charles du 20/11 à 14 h 13 : « corrige tous les points », « qu'elle chatte tout le temps, même après une vente »)
Date : 2026-11-20
Précise : ADR 0103 (curseur, désir, porte du premier teaser), ADR 0088 (mode soin), fiche P6-02. Ne remplace aucun ADR.

## Contexte

Le chemin jusqu'à la première étape payante est codé. Ce qui suit son envoi ne l'est pas :

- un achat ou un pourboire ne réveille pas l'agent, et l'historique garde l'étape « verrouillée, non payée » ;
- un refus finit en réponse neutre ; `maySulk` n'a aucun appelant ;
- une étape laissée en plan reste ouverte : deux messages du lendemain (« salut », « ça va ? ») comptent comme un refus ;
- à « c'est combien ? » ou « comment je l'ouvre ? », la voix ne voit ni le prix ni le contenu, et la garde `price_outside_offer` bloque le prix ;
- aucune relance de vente ; `post_offer.delay_days`, `response_delay_minutes` et `follow_ups.nudges` sont affichés dans le CRM et lus nulle part ;
- « je viens de jouir » fait monter le désir, l'étape suivante peut partir juste après.

## Décision

Chaque moment après une étape payante reçoit une consigne écrite par le code, comme le recadrage et les relances. Le cerveau rapporte, le code décide. L'âge en doute et « fan en difficulté = ventes gelées » passent avant tout ce qui suit.

1. **Une étape oubliée n'est pas refusée.** Un silence de lui pendant une session refroidie met le déroulé en pause (`stalled`) au lieu de compter ses messages suivants comme un refus. Le refus implicite ne compte que les messages d'une même session. Au retour, une étape restée fermée est rappelée une fois, légèrement, sans nouveau prix.
2. **Achat vu, aftercare.** L'historique enregistre une étape payée comme payée. Une vente Reveal (étape, pourboire) rattachée à un fan réveille sa conversation : un brouillon d'aftercare (merci, tendresse, sans en faire trop), ni offre ni bouderie juste après. En copilote, c'est un brouillon comme les autres ; rien ne part sans le chatteur.
3. **Après un refus, dans l'ordre** : elle demande ce qui ne lui a pas plu, insiste un peu une fois, boude une fois au plus (`maySulk` : jamais un fan gelé, fragile ou « ne plus écrire », jamais juste après un achat), puis lâche. La raison qu'il donne est gardée dans sa fiche, datée.
4. **Aide au paiement.** Quand il demande le prix, comment ouvrir ou s'il doit payer, la voix voit l'étape en attente : ce qu'elle contient et son prix exact, que la garde laisse passer pour ce seul montant. Si ça bloque encore au message suivant, une alerte appelle un humain. Amendement du 27/11 (Charles, banc de la Sécurité) : `price_outside_offer` ne bloque plus que trois cas, une remise restant à `discount` : un prix ou un oui sur un sur-mesure ; un montant qu'elle accepte (« ok 10 € ») autre que celui de l'offre ; un prix pour ce qu'elle vend (phrase de vente autour du montant) autre que celui de l'offre fixé par le code, ou n'importe lequel sans offre en cours. Passent un montant de la vie courante (« 5 € mon café »), le montant qu'il vient d'écrire repris sans accord, et le vrai prix de l'offre répété tel quel. Une bulle faite d'un montant seul (« 15 euros »), ou un montant juste après qu'il a demandé un prix, compte comme un prix à elle (réserve de la Sécurité, #1043).
5. **Relances de vente.** Après une étape refusée ou restée sans réponse, des relances de vente au délai de `post_offer.delay_days`, en nombre borné, dans les règles de relance déjà décidées ; aucune pour un fan gelé, fragile, en détresse ou à l'âge contesté, et chacune repasse par `offerDecision`.
6. **Après l'orgasme.** Un signal fermé du cerveau (« il vient de jouir ») fait retomber le moment chaud, met le déroulé en pause et déclenche l'aftercare. **Amendement du 26/11/2026** (règle métier du guide, relayée par Audit IA le 26/11) : le déroulé ne se met plus en pause, il **se termine** pour la soirée. Aftercare toujours, rien n'est vendu ce soir-là, et l'étape payante qui attendait n'est pas rappelée le soir même. S'il a joui sans rien acheter du script, aucune étape n'est poussée : elle est tendre, un peu vexée, et le script peut revenir plus tard par une autre variante d'accroche. Le « même soir » dure au moins son délai entre deux scripts et ne finit jamais avant son lendemain (`sameEvening`).
7. **Le reste du lot**, en PR courtes à la suite :
   - la mémoire du fan est datée (« dit il y a 3 jours ») ;
   - ce qu'elle raconte d'elle à un fan est gardé et relu, pour ne pas se contredire ;
   - une plainte sur un achat ouvre une alerte à l'équipe et demande la validation d'un humain ;
   - elle dit au revoir quand ses heures ferment au milieu d'une conversation chaude ;
   - le délai avant de répondre suit `response_delay_minutes`, tiré au hasard autour (avant l'Automatique) ;
   - les réglages de persona encore lus nulle part sont branchés ou masqués ;
   - le juge gagne un critère « vente », et les évals jouent une vente en plusieurs messages (achat, refus, ne sait pas payer, revient le lendemain).

## Conséquences

- Positives : la première vente devient un client qui revient ; les chiffres de refus cessent d'être faussés ; elle reste présente après l'achat.
- Négatives : plus de brouillons à valider pour le chatteur (aftercare, relances) ; un lien vente → conversation à tenir côté connecteur (fil Bilan).
- À surveiller : le taux de rachat et le taux de refus après ce lot ; une relance de vente mal reçue doit pouvoir être coupée par fan.

## Alternatives rejetées

- **Laisser le cerveau écrire ces moments.** Ses mots ont déjà dérivé sur le compliment ; les règles de vente vivent dans le code.
- **Envoyer l'aftercare seul, sans brouillon.** Aucun envoi réel sans le mot de Charles ; l'Automatique viendra après.
- **Tout en une PR.** Trop long à relire ; un point par PR, dans l'ordre 1, 2, 3, 4, 5, 6.
