# CR-13 Poser et déplacer les shifts au doigt : glisser-déposer, ajout en masse, semaine en modèle, suggestion
Statut : todo (prototype validé par Charles le 02/11/2026 à 17h47, ADR 0045 § 7) (ADR 0045 § 3, acceptée le 02/11/2026). Référence visuelle : le prototype https://claude.ai/artifact/8AJCiUp1ZoEXEvfx9wknPE (données inventées).
Phase : espaces (ADR 0045)
Dépend de : CR-12 ; les notifications de ces gestes passent par EQ-12
Branche : task/cr-13-shift-calendar-editing

## Objectif
Poser une semaine prend quelques gestes, au doigt comme à la souris, sans jamais écraser un shift, un congé ni le travail d'un chatteur.

## Contexte à lire
`docs/adr/0045-shift-calendar-for-everyone.md` (§ 3, § 4, § 7), `docs/adr/0031-leaves-and-shift-swaps.md` (verrou par membre), `docs/adr/0025-chatter-access-during-shift.md` et `docs/adr/0032-pay-period-closing.md` (pourquoi un shift commencé ne bouge pas), EQ-02, `apps/api/src/modules/scheduling/`, `docs/design/README.md` (ressorts, § Finition d'un écran), le prototype validé (CR-12).

## À faire
- [ ] Réservé au propriétaire et à un manager actif ; chaque écriture passe par les contrôles du serveur d'aujourd'hui (conflits, congé, premier jour du membre, verrou par membre) et porte une clé d'idempotence.
- [ ] **Glisser-déposer** : à la souris, et par un appui long puis le doigt sur téléphone (retour haptique si l'appareil le permet) ; sans appui long, le doigt fait défiler. Pendant le geste, la case visée dit déjà si elle est libre, et pourquoi sinon, en ambre et jamais en rouge (une case prise n'est pas une urgence) ; au lâcher, le shift se pose avec le ressort du design system ; un refus du serveur le ramène à sa place avec la raison, jamais en silence. Annulation pendant 5 secondes, qui est une écriture du serveur comme une autre : sa propre clé d'idempotence, les mêmes contrôles ; si la case d'origine a été prise entre-temps, elle est refusée avec sa raison. Seul un shift qui n'a pas commencé se glisse (`shift_started_conflict`, `shift_ended_conflict`). Glisser sur la ligne d'un autre membre le change de mains, aux règles d'un shift posé à la main. Le même déplacement existe au clavier et depuis la fiche d'un shift.
- [ ] Déplacer une occurrence d'un modèle de shift ne déplace qu'elle ; changer le modèle reste un geste à part.
- [ ] **Ajout en masse** : un membre, plusieurs jours et créneaux ; l'aperçu dit quelles cases sont prises ou tombent dans un congé, jamais écrasées ; le serveur recalcule à la validation, saute et liste une case prise entre-temps, pose le reste en une transaction.
- [ ] **« Faire de cette semaine le modèle »** : récapitulatif de ce qui s'ajoute et s'arrête, qui nomme les shifts non commencés de modèles arrêtés, retirés et leurs membres prévenus ; un shift posé à la main n'est jamais touché ; rien de rétroactif.
- [ ] **Suggestion de chatteur** à l'ajout, par le code, sans IA : membres actifs de cette créatrice classés par heures de shifts finis sur elle sur 90 jours (jamais un montant), puis les moins chargés de la semaine ; jamais un membre déjà en shift à cette heure, en congé ou hors de ses créatrices. Elle ne pose rien seule.
- [ ] Chaque geste émet l'événement que les notifications d'EQ-12 lisent (posé, déplacé, retiré, changé de mains, ajout en masse résumé ; un déplacement annulé ne prévient personne).
- [ ] **Réglages du planning** (ADR 0049 § 1 et § 2), propriétaire seul, hors de la barre d'outils (icône au bout de la légende) : frise de 24 h dont on glisse les coupures, une carte par créneau (nom facultatif, début et fin à ± 1 h, durée, retrait qui rend ses heures au créneau d'avant), « Ajouter un créneau » qui coupe le plus long, modèles de journée, « Chatteurs en même temps » par compte (1 ou 2) ; aperçu en direct sur la grille, rien d'écrit avant « Enregistrer » ; résumé fixe en bas (shifts recalés, shifts posés à la main qui ne tombent plus pile, doublons) ; prise d'effet datée ; « Recaler la semaine modèle » coché par défaut. Prototype : https://claude.ai/artifact/8AJCiUp1ZoEXEvfx9wknPE.
- [ ] **Renfort** (ADR 0049 § 2) : « + » sur une case prise, chatteur et heures dans le créneau ; trois chatteurs au plus en même temps sur un compte ; verrous dans l'ordre comptes puis membres ; test d'intégration de deux renforts concurrents sur un compte qui en a déjà deux, un seul passe. Glisser sur une case pleine dit pourquoi et renvoie au « + ».

## Critères d'acceptation
- Tests du domaine : case prise, congé, shift commencé ou fini refusés ; changement de mains ; ajout en masse avec une case prise entre l'aperçu et la validation ; semaine en modèle qui arrête un modèle et retire ses shifts non commencés, sans toucher un shift posé à la main ; ordre de la suggestion et ses exclusions.
- Tests d'intégration : deux déplacements concurrents d'un même membre (verrou), rejeu d'une même clé d'idempotence sans double effet, un manager non actif refusé.
- Glisser-déposer vérifié sur un vrai iPhone et un Android d'entrée de gamme : défilement sans appui long, appui long puis glisser, lâcher hors grille, refus du serveur, annulation (et annulation refusée quand la case d'origine a été prise) ; captures et courte vidéo dans la PR.
- Finition (Charles, 02/11, 16h45) : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (Nuit et Jour, téléphone et ordinateur, mouvement réduit), relues par Extension.

## Hors périmètre
Envoi des notifications (EQ-12) ; lecture et vue Mois (CR-12) ; échanges entre chatteurs (déjà faits, ADR 0031).

## Notes de session
