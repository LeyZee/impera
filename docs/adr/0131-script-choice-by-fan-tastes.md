# 0131. Choisir le script qui colle à ce que le fan aime : familles de fantasme et goûts

Statut : proposed (fil « Concevoir les scripts de vente à branches », 16/11/2026 ; relu par Agent et Médias le 16/11 ; questions tranchées par Charles le 16/11 à 14 h 20-21 ; attend « ok 0131 », puis « ok 0131 » de Charles)
Date : 2026-11-16
Précise : ADR 0098 § 6 (le cerveau choisit parmi les scripts que le code permet), ADR 0056 § 6 et SC-04 lot c8 (identité d'un script), ADR 0085 (fiche du fan), ADR 0112 § 5 (conditions structurées de branche). Ne remplace aucun ADR.

## Contexte

Le 16/11/2026, Charles demande que l'IA propose toujours le script qui colle à la situation, au fantasme et à l'envie du fan : si une créatrice porte dans un script la tenue d'une couleur que le fan a dit aimer, c'est ce script qu'il faut lui proposer plutôt qu'un autre.

Aujourd'hui, le code dresse la liste des scripts permis (moment, média déjà reçu, descriptions et identité validées, limites de la persona) et le cerveau choisit en lisant l'identité de chacun (ambiance, énergie, décor, « à utiliser quand », « à éviter quand »), en texte libre. Rien ne relie ce choix à ce que la fiche du fan sait de lui (couleur préférée, tenues, envies, intensité cherchée, qu'elle mène ou se laisse mener) : le cerveau peut le faire ou l'oublier, et personne ne peut vérifier pourquoi.

## Décision

### A. Ce que porte un script

1. **Une famille de fantasme**, une seule, dans une liste fermée (`ScriptFantasyFamily`, `@impera/contracts`), reprise de la recherche et ramenée à ce qu'une créatrice seule peut tourner : `intimacy` (passion, tendresse), `she_leads` (elle mène), `she_follows` (elle se laisse guider), `novelty` (nouveauté, aventure), `forbidden` (interdit léger, le secret), `watch_me` (il la regarde se préparer, s'habiller, se montrer), `focus` (tout le script tourne autour d'un seul goût : une tenue, une couleur, une matière). La liste se règle dans le code, pas dans un prompt.

2. **Des goûts** (« goût » : un trait concret qu'un script sert et qu'un fan aime ; le mot « élément » est déjà pris par les médias). Le code (`@impera/contracts`) ne fixe que les familles et les **sortes** de goût : tenue, couleur, matière, lieu, intensité finale (`soft`, `naughty`, `very_explicit`, les valeurs de la fiche du fan). Les **valeurs** de chaque sorte vivent **par créatrice, en base**, saisies dans le CRM : aucune liste de tenues ni de couleurs dans le dépôt, et la fiche d'un fan prend les valeurs de sa créatrice. Les goûts se posent **par branche** (une branche premium peut avoir une autre tenue) ; au niveau du script, tenue, couleur, matière et lieu se lisent comme l'union de ses branches, **l'intensité comme celle du chemin par défaut** (une union d'intensités ne veut rien dire).

2 bis. **Des thèmes**, une sorte de goût de plus (relecture Agent, 16/11/2026 : les fantasmes que Charles veut voir repérés et nourris sont souvent des scénarios ou des envies, pas seulement un visuel). Leur vocabulaire est posé **par l'agence, créatrice par créatrice, dans le CRM**, et borné par sa fiche persona : un fantasme qu'elle déclare peut devenir un thème, une limite ou un dégoût en retire un. Comme les autres valeurs, le dépôt n'en contient aucune : le code ne connaît que la mécanique.

3. **D'où ils viennent** : proposés par le cerveau qui écrit l'identité (SC-04 c8), à partir des descriptions validées des médias, jamais inventés au-delà ; relus et validés par l'agence sur le même écran que l'identité, mais **gardés à côté d'elle, hors de son empreinte d'entrée** : sinon toutes les identités déjà validées tomberaient. Un goût non validé ne compte pas. Un script sans famille validée reste proposable (rien ne régresse) mais n'est jamais classé devant un script qui en a une.

### B. Ce que le code lit du fan

4. **La fiche du fan (ADR 0085) reste en texte**, comme aujourd'hui. Pour que le code compare, le job de lecture de la fiche (`read-card`, qui écrit déjà des faits datés) pose en plus, sur les champs `favourite_colour`, `outfits`, `desires`, `lead` et `intensity`, des **goûts du même vocabulaire** (une couleur, une tenue, une famille, un thème de la créatrice) quand ce que le fan a dit s'y range clairement ; sinon rien. Chaque goût garde sa date (`at`) et sa source (`said`, il l'a dit ; `observed`). Un chatteur le corrige comme le reste de la fiche.

5. **Ce qu'il a demandé passe avant ce qu'il aime** : un goût qu'il a dit dans la session en cours se lit comme « demandé », sans attendre que la fiche soit écrite, et pèse plus qu'une couleur notée il y a trois semaines.

### C. Comment le code classe

6. **Le cerveau choisit parmi tous les scripts permis ; ce qui colle au fan passe d'abord, le classement ne fait que départager** (Charles, 16/11/2026 à 14 h 20, précisé à 14 h 20 : « peu importe s'il est mal classé, c'est le seul qui correspond à ce que le fan désire ; s'il y en a deux qui font la même chose, elle doit prendre le mieux classé »).
   - **D'abord la correspondance** : pour chaque script permis, le code calcule ce qui colle au fan (ses goûts contre ceux du fan, demandé dans la session > noté sur la fiche > famille compatible avec `lead`). Un script très spécifique qui colle à ce qu'il aime (une pratique précise, un thème de la créatrice) passe devant un script général mieux classé.
   - **Ensuite le classement**, seulement entre scripts qui collent autant au même goût (deux scripts au même goût du fan) : l'ordre de l'agence, puis, quand la mesure de l'ADR 0129 a assez de fans, le revenu par fan exposé.
   - Le cerveau reçoit tous les scripts permis (dans la limite déjà fixée, `BRAIN_SCRIPTS_MAX`) dans cet ordre, chacun avec la ligne « colle à : … » calculée par le code, et choisit selon le moment. Le code vérifie qu'il choisit dans la liste, et la trace (§ 9) dit quand il a pris un script qui collait moins qu'un autre.
   - Aucune pondération dans un prompt : l'ordre est celui du code.

7. **Ce qui ne se contourne pas** : un script hors des limites ou des dégoûts de la créatrice n'entre jamais dans la liste, quel que soit le fantasme du fan ; un fantasme du fan hors de ses limites ne se nourrit pas. **L'intensité** : un script dont l'intensité finale dépasse de plus d'un cran celle que cherche le fan (fiche) passe derrière les autres, sans être retiré de sa liste (Charles, 16/11/2026 à 14 h 20).

8. **Dans une branche** : une condition structurée nouvelle, `fan_likes` (un goût du vocabulaire de la créatrice), rejoint la liste fermée de l'ADR 0112 § 5, avec l'intensité propre de chaque branche. Elle choisit la branche dont le goût est sur sa fiche, évaluée par le code seul, et suit l'ordre de décision de l'ADR 0112 § 6.

9. **Trace** : le choix du script laisse sa raison (`script_started` porte les goûts qui ont collé), montrée dans « Pourquoi » au playground et dans la conversation côté agence.

### D. Les textes

10. Les textes autour du bundle (teaser, renfort, après le média) peuvent reprendre le goût qui a collé. La voix le reçoit comme une donnée du bloc typé `<script_step>`, jamais comme une consigne de style dans le prompt ; la manière de s'en servir vient de la banque d'exemples privée de la créatrice, hors du dépôt.

## Partage du travail

| Lot | Contenu | Fil |
|---|---|---|
| a | Familles et sortes de goût dans `@impera/contracts` ; valeurs par créatrice en base et dans le CRM (thèmes compris) ; goûts par branche proposés avec l'identité, validés à côté d'elle ; glossaire (« goût », « famille de fantasme ») | Médias (+ Bilan pour le prompt d'identité) |
| b | Goûts datés sur la fiche du fan, posés par `read-card` ; goût dit dans la session lu comme « demandé » | Agent (+ Bilan pour le prompt) |
| c | Classement des scripts permis, ligne « colle à », trace | Agent |
| d | Condition de branche `fan_likes` | ce fil (lot 2 bis des branches) |
| e | Écran : famille et goûts à valider avec l'identité ; valeurs de la créatrice | Design |

Place : après le lot 2 des branches (moteur côté code), en parallèle du lot 3, sans retarder ni l'un ni l'autre ; le lot a après #801, et après 0128 et 0129 si elles sont acceptées avant.

## Questions à Charles (toutes tranchées)

1. ~~Qui choisit entre les scripts~~ : **tranché le 16/11/2026 à 14 h 20, l'IA parmi tous les permis ; ce qui colle au fan d'abord, le classement pour départager** (§ 6).
2. ~~Intensité~~ : **tranché le 16/11/2026 à 14 h 20, il passe derrière** (§ 7).
3. ~~Familles~~ : **tranché le 16/11/2026 à 14 h 21, les sept telles quelles** (§ 1).

## Conséquences

- Le choix d'un script devient explicable : on voit pourquoi ce script plutôt qu'un autre.
- Un script gagne une famille et des goûts à valider, à côté de son identité ; un script déjà validé sans famille reste proposable mais passe derrière, et aucune identité validée ne tombe.
- La mesure (ADR 0129) pourra comparer le taux d'achat quand le script collait au fan et quand il ne collait pas.
- Le dépôt ne contient que des fonctions configurables et les sortes de goût : aucune valeur, aucune liste d'une créatrice, aucune zone du corps, même fictive.

## Alternatives rejetées

- **Laisser le cerveau rapprocher librement la fiche et l'identité** : invérifiable, et une règle de vente vivrait dans un prompt.
- **Recherche par similarité de texte (embeddings) entre la fiche et l'identité** : opaque, impossible à expliquer à l'agence, et sensible aux tournures.
- **Un script par fantasme et par fan** : multiplie les tournages ; les branches et le classement servent le même but avec le stock existant.
