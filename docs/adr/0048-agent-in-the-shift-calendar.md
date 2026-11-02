# 0048. L'IA dans le calendrier des shifts : ses heures se lisent à côté de celles des chatteurs

Statut : accepted (Charles, 02/11/2026 17h47, « oui vas y » en réponse à la demande de « ok 0048 », avec la validation du prototype ; demande du même jour à 17h18, après le prototype du calendrier de l'ADR 0045 ; relectures de Bilan, Équipe et Extension intégrées)
Date : 2026-11-02
Précise : l'ADR 0045 § 1 (ce que chacun voit) et § 2 (les vues), qui ne parlaient que des membres ; P3-14 (heures d'activité de l'agent). Ne change rien à l'ADR 0045 pour les shifts.

## Contexte

Le calendrier de l'ADR 0045 montre qui chatte quand, membre par membre. Mais un compte n'est pas tenu que par des chatteurs : l'agent répond aussi, aux heures d'activité réglées créatrice par créatrice (P3-14, `creators.agent_hours`), dans un mode (`AgentMode` : Automatique, Copilote, Arrêt). Après avoir vu le prototype, Charles a demandé le 02/11 à 17h18 d'« ajouter les plannings de l'IA, mêlés aux chatteurs […] pour voir qui chatte ».

Sans cela, un créneau sans chatteur se lit « à pourvoir » même quand l'agent y répond seul, et un chatteur ne sait pas si celui qui le précède est un collègue ou l'agent.

## Décision

### 1. Ce qui s'affiche

- Pour chaque compte, les heures où l'agent répond (`agent_hours.reply`) et son mode en vigueur (Arrêt quand l'arrêt global est levé) s'écrivent en clair, jamais par une marque sans légende : une étiquette sur le compte (« IA automatique · 9 h – 1 h »), et sur chaque ligne de créneau la part qu'il couvre (« IA », « IA dès 9 h », « IA jusqu'à 1 h ») ; rien en Arrêt.
- Un créneau **sans chatteur** que l'agent couvre en entier **en Automatique** s'affiche « IA seule » et ne compte pas dans les créneaux à pourvoir. En Copilote, il reste « à pourvoir » : chaque brouillon y attend un humain (ADR 0019, ADR 0025).
- En tête du calendrier, une carte par compte dit qui chatte maintenant et jusqu'à quand, si l'agent est actif et dans quel mode, et qui suit ; la question « qui avant, qui après » d'un chatteur dit « l'IA seule » quand l'agent tient seul le créneau voisin.
- L'IA a sa place dans la légende du calendrier, comme un membre : un geste la suit sur la grille.
- Pour l'agence seulement, un encart « Couverture des comptes » dit, par compte et pour la semaine affichée, les heures tenues par un chatteur avec l'agent, par un chatteur seul, par l'agent seul (Automatique seulement) et par personne.
- La vue Mois compte un créneau « IA seule » comme tenu ; le détail d'un jour rappelle, par compte, les heures et le mode de l'agent.

### 2. Qui le voit

- Le propriétaire, un manager actif et un chatteur actif : comme le planning de toute l'équipe (ADR 0045 § 1).
- Un membre dont le statut n'est pas `active` garde le scope `self` et ne voit que ses propres shifts, sans l'agent.
- **Pas la créatrice** : elle ne voit jamais qui a écrit un message envoyé (ADR 0042 § 2, ADR 0021) ; les heures de l'agent sur ses comptes le lui diraient heure par heure. Sa couche « shifts de mes comptes » reste celle de l'ADR 0045.
- Le lien de calendrier (ADR 0045 § 5) ne porte jamais l'agent.

### 3. Les données

- Rien de nouveau n'est stocké : la lecture reprend les heures d'activité et le mode déjà en base. Elle ne rend, par créatrice de l'agence, que le mode en vigueur et les créneaux de réponse dans son fuseau ; jamais les heures calmes des relances, la persona, les prompts, le budget ni un chiffre.
- Elle applique la même frontière que la lecture du calendrier (ADR 0045 § 1) : propriétaire ou scope `agency`, tout ; chatteur actif, toutes les créatrices de l'agence ; tout autre appel, rien. Les heures et le mode vivent dans des tables par créatrice : la lecture est une fonction sœur `SECURITY DEFINER`, en lecture seule, de celle des shifts. Les deux appellent une même fonction SQL interne qui rend la portée du lecteur (toute l'agence, l'équipe, ses seuls shifts, la créatrice, rien), pour que leurs frontières ne divergent jamais ; celle de l'agent ne rend rien hors de l'agence et de l'équipe, et lit l'arrêt global elle-même (choix de Bilan, 02/11). Un test d'intégration par frontière, créatrice comprise.

### 4. Ce que le calendrier ne fait pas

- Il ne règle ni les heures ni le mode de l'agent : depuis le calendrier, le propriétaire ouvre Réglages › Agent (P3-14). Un chatteur ne change jamais le mode (ADR 0024).
- L'agent n'est pas un membre : il n'a ni shift, ni charge, ni rapport, ni paie, et la suggestion de chatteur (ADR 0045 § 3) ne le propose jamais.

## Conséquences

Positives :
- On voit d'un coup d'œil qui tient chaque compte à chaque heure, humain ou IA, et où il n'y a vraiment personne.
- Quand l'agent passera en Automatique, les créneaux qu'il tient seul cesseront d'être signalés à pourvoir, sans réglage de plus.

Négatives, à surveiller :
- Les chatteurs voient les heures de l'agent de toutes les créatrices : ce sont des horaires, rien d'autre.
- Des heures d'activité qui changent selon le jour de la semaine ne tiennent plus sur l'étiquette d'une ligne : le jour qui diffère porte sa propre mention dans ses cases.

## Alternatives rejetées

- **Une ligne « IA » à part par compte** : plus lourde, et elle sépare ce que Charles veut voir mêlé.
- **Un badge « IA » dans chaque shift** : essayé dans le prototype, il répète la même marque sur presque chaque case et écrase la hiérarchie.
- **Un trait dégradé sous les créneaux** : essayé ensuite, Charles ne l'a pas compris (02/11, 17h35).
- **Montrer l'agent à la créatrice** : contraire à l'ADR 0042 § 2.
