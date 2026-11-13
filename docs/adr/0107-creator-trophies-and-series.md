# 0107. La créatrice gagne des médailles de série et des trophées pour ce qu'elle fait pour l'agence

Statut : accepted (« ok 0107 » de Charles le 13/11/2026, 2 h 33 heure de Paris ; demande de Charles du 13/11/2026, 2 h 27 heure de Paris ; numéro attribué par le coordinateur le 13/11)
Date : 2026-11-13
Précise : l'ADR 0042 § 3 (série et journée réussie de la créatrice, personne ne lui impose rien) et § 7 (notifications), l'ADR 0055 § 4 (demande de contenu) et § 6 (états d'un dépôt), l'ADR 0044 § 4 (« à refaire »). Reprend pour la créatrice les limites de l'ADR 0104 § B. Ne remplace rien.

## Contexte

Le chatteur a son jeu (ADR 0104 § B) : médailles de palier, écussons de trophées, série, et un dévoilement animé avec son à chaque gain. Charles veut l'équivalent pour la créatrice, « pour la féliciter de faire toutes les tâches qu'on lui demande », avec des paliers, des séries et le même dévoilement.

Ce que la créatrice fait réellement dans Impera, et que le code sait vérifier :

- elle **coche sa routine** : chaque jour où toutes les tâches essentielles qu'elle a acceptées sont faites est une « journée réussie » ; la série de journées réussies existe déjà (`creator-tasks/domain/streak.ts`), avec un joker et des paliers à 7, 14, 30, 50 et 100 jours, et s'affiche à côté de sa journée (« 12 jours de suite ») ;
- elle **livre ce que l'agence lui demande** : une demande de contenu (ADR 0055 § 4) a une échéance, et un dépôt fait depuis elle la satisfait ;
- elle **dépose du contenu** dans ses catégories, scripts compris (ADR 0055 § 1, ADR 0056) ;
- elle **accepte ou refuse** les suggestions de l'agence, sans jamais rien devoir (ADR 0042 § 3).

Un jeu ne tient que s'il raconte ces faits-là. Il ne doit jamais devenir une obligation déguisée : refuser une demande reste son droit, et ne lui coûte rien.

## Décision

### A. Ce qu'elle gagne

1. **Médailles de série.** Sa série de journées réussies garde ses règles actuelles (ADR 0042 § 3 : joker, fuseau, calcul par le serveur). Chacun de ses paliers devient une médaille, la pièce dans son laurier de l'ADR 0104, gravée du nombre de jours en chiffres arabes : 7 (bronze), 14 (argent), 30 (or), 50 (or, une étoile) et 100 (or, deux étoiles). Sous 28 px, une pièce ne s'affiche jamais sans son nom à côté. Une médaille gagnée reste gagnée, même quand la série retombe ; la série repart de zéro, la vitrine garde la meilleure.
2. **Série de livraisons.** Une seconde série compte ses demandes de contenu livrées à l'heure, d'affilée, dans l'ordre de leurs échéances. Une demande est **livrée à l'heure** quand un dépôt fait depuis elle, non retiré, est arrivé (état Reçu ou au-delà, ADR 0055 § 6) au plus tard à la fin du jour de l'échéance, dans son fuseau. Une demande livrée en retard, ou dont l'échéance passe sans dépôt, remet la série à zéro. Une demande qu'elle refuse avant la fin du jour de l'échéance, ou que l'agence annule, ne compte pas et ne casse rien.
3. **Trophées.** Une liste fermée, écrite dans le code, chacun lié à un fait vérifiable, gagné une fois et jamais perdu (même si un dépôt est ensuite retiré) :

| Trophée | Fait vérifié | Symbole proposé |
|---|---|---|
| Premier dépôt | son premier dépôt arrivé (état Reçu ou au-delà) | un appareil photo, pastille « 1 » |
| Première livraison à l'heure | sa première demande livrée à l'heure | un colis, pastille cochée |
| 5 livraisons à l'heure | une série de livraisons de 5 | le colis, pastille « 5 » |
| 10 livraisons à l'heure | une série de livraisons de 10 | le colis, pastille « 10 » |
| 25 livraisons à l'heure | une série de livraisons de 25 | le colis, pastille « 25 » |
| Journée parfaite | une journée où toutes ses tâches du jour sont faites, essentielles et les siennes (ADR 0042 § 3) | un calendrier coché et une étoile |
| Premier script tourné | son premier dépôt de catégorie Script arrivé | un clap, pastille « 1 » |
| Stock plein | un jour où chacune de ses catégories actives (au moins deux) est au-dessus de son seuil (ADR 0055 § 5) | une jauge pleine |
| Contenu qui a cartonné | une de ses publications devient « à refaire » (ADR 0044 § 4) ; codé seulement quand ce signal existe | une vignette de photo et un éclat |

4. **Pas de niveaux** pour la créatrice dans cette version : deux séries et neuf trophées suffisent, et un rang de plus l'encombrerait.

### B. Ce que le jeu ne fait jamais

5. **Aucun effet sur l'argent.** Aucun trophée ni aucune série ne lit ses gains, sa part, la part de l'agence ou ses ventes, et rien du jeu n'entre dans un calcul d'argent. Une prime liée à un trophée demanderait sa propre décision de Charles, avec ses règles écrites avant.
6. **Refuser ne coûte rien.** Refuser une suggestion ou une demande, ou ne rien accepter, ne fait perdre ni trophée, ni médaille, ni série (ADR 0042 § 3). Le jeu ne félicite que ce qu'elle a fait.
7. **Pas de hasard, pas de rappel pour revenir.** Aucune récompense tirée au hasard. Le jeu n'envoie aucune notification, ni téléphone ni Telegram : la raison `streak` des notifications n'est pas utilisée par le jeu, et rien ne la prévient qu'une série est menacée en dehors de l'application. La phrase déjà affichée à côté de sa journée (« Coche ta routine aujourd'hui pour garder ta série ») reste telle quelle, en ambre.
8. **Pas de comparaison.** Aucun classement entre créatrices, aucune moyenne de l'agence.

### C. Où elle le voit

9. **À côté de sa journée.** La série de journées garde sa place ; la dernière médaille gagnée s'y ajoute, en petit, à côté du nombre de jours. Rien d'autre ne s'ajoute à son écran du jour.
10. **Dans Moi, « Mes trophées ».** Une vitrine : ses médailles de série (la prochaine en silhouette, avec « encore N jours »), sa série de livraisons et sa meilleure, ses trophées gagnés avec leur date, et ceux qui manquent en silhouette avec une ligne qui dit comment les gagner. Le nom est toujours écrit à côté de l'objet.
11. **Le dévoilement.** Celui du chatteur, sans en changer le dessin ni le mouvement : une seule lecture, à l'écran où elle vient de faire le geste qui le gagne (coche, dépôt envoyé), sinon à sa prochaine ouverture d'Aujourd'hui, de l'Agenda ou du Contenu ; jamais sur une conversation. Plusieurs gains d'un coup : trois dévoilements à la suite au plus, le reste dans la vitrine. Son activé par défaut, avec un interrupteur dans Moi ; immobile avec « réduire les animations ». Aucune information n'existe seulement dans l'animation.
12. **L'agence** (propriétaire, manager actif) voit ses séries et ses trophées sur sa fiche, en lecture. Un chatteur ne les voit jamais.

### D. Comment c'est fait

13. **Une table** des trophées gagnés (créatrice, trophée, date, fait qui l'a donné, date du dévoilement vu), unique par créatrice et trophée, `FORCE RLS` : la créatrice lit les siens et marque un dévoilement vu ; l'agence lit ; seul le job écrit. Les séries ne sont pas stockées : elles se recalculent depuis ses coches et ses demandes, comme aujourd'hui.
14. **Un job rejouable** constate les trophées après une coche, après un dépôt arrivé et chaque nuit dans son fuseau ; rejoué, il ne donne rien deux fois.
15. **Les seuils sont dans le code**, pas en réglage : la liste est courte et chaque trophée doit dire la même chose à toutes.
16. **Un seul langage graphique** avec le chatteur : mêmes pièces, mêmes écussons, même dévoilement, même composant ; seuls les symboles de la créatrice sont propres à ses gestes. Chaque symbole doit dire son trophée sans légende, sa forme principale sur l'axe de l'écusson et sa pastille rentrée dans le coin, et être rendu et regardé en grand et à 24 à 40 px, Nuit et Jour, avant d'être montré.

## Conséquences

- Positives : la créatrice voit que ce qu'elle fait compte, sur ce qui sert vraiment l'agence (régularité, délais tenus, stock) ; l'agence voit d'un coup d'œil qui tient le rythme.
- Négatives : une table et une migration ; un job de plus ; des symboles à dessiner et faire valider.
- À surveiller : si la série de livraisons retombe souvent à zéro, c'est que les échéances sont trop serrées : c'est l'agence qui règle ses demandes, pas le jeu qui doit punir moins.

## Alternatives rejetées

- **Des trophées sur ses ventes ou ses gains** : ses ventes dépendent aussi des chatteurs et de l'agence, et un jeu sur l'argent la pousserait vers ce qu'elle n'a pas choisi, contre l'ADR 0042 § 3.
- **Une série qui casse quand elle refuse** : ferait du jeu une obligation déguisée.
- **Une notification « ta série est en danger »** : mécanique de dépendance, et contraire à sa vie privée (heures calmes, plafond, ADR 0042 § 7).
- **Des niveaux** comme le chatteur : une couche de plus pour un gain faible ; à revoir si elle en redemande.
