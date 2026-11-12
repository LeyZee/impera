# 0098. Le déroulé d'un script se tient fan par fan : le code choisit l'étape et le prix, la voix ne fait que les dire

Statut : accepted (Charles, 12/11/2026 22h28, « ok 0098 », fil Agent ; réponses du 12/11 22h21 et choix « aucun compteur » du 12/11 22h19 ; correction de vente n° 1, « go vente » du 12/11 22h09)
Date : 2026-11-12
Précise : P6-01 (réserve `script_runs`), P6-02 (après une offre), l'ADR 0056 (structures, étapes, ponts, moment), l'ADR 0064 (cartons), l'ADR 0018 (Reveal fait foi pour ce qui est parti), la politique d'offre (`agent/domain/policy.ts`, décision du 17/10).

## Contexte

Aujourd'hui, pour l'agent, une vente n'est qu'une décision : « offre permise ou non » (`offerDecision`). Il ne connaît pas la notion d'étape. Or un script de l'agence est une suite ordonnée : des **étapes offertes** (le teasing, en séries A, B ou C), des **étapes payantes** (un pack par étape) et des **ponts offerts** entre deux étapes. L'argent se fait en déroulant le script dans la même session chaude. Pour cela, il faut savoir, pour chaque fan, à quelle étape il en est, ce qu'il a ouvert, acheté ou refusé, et quoi faire ensuite.

Les morceaux existent déjà mais ne sont pas reliés :
- l'atelier de structures (module `scripts`, ADR 0056) décrit les étapes et les ponts côté tournage ;
- les événements `script_started`, `script_step_sent`, `script_ended`, `offer_made` et `sale_detected` existent dans le contrat, mais personne ne les écrit pour un fan ;
- le jour ou la nuit se calcule sur son horloge à elle (`situation.ts`) ;
- la politique sait dire si une offre est permise (délai, désir, âge, gel), mais pas laquelle.

## Décision

### A. Ce qu'est un déroulé

1. **Un déroulé (`script_run`) = un script proposé à un fan.** Au plus un déroulé ouvert par fan à la fois. Un script ne se rejoue jamais au même fan, qu'il ait été acheté, refusé ou abandonné : c'est la garantie que P6-01 réservait.

2. **Son état est tenu par le code**, dans une table `script_runs` du module `agent`, sous la RLS de la créatrice :
   - le script et sa version (la structure figée qui l'a produit) ;
   - l'étape en cours (sa clé de segment, ADR 0056 : la clé ne change jamais, le numéro si) ;
   - pour chaque étape passée : envoyée, ouverte, achetée, refusée ou sans réponse, avec l'heure ;
   - l'état du déroulé : `open`, `bought_out` (tout acheté), `refused`, `stalled` (sans réponse), `closed_by_human`.

   Chaque changement écrit aussi un événement (`script_started`, `script_step_sent`, `script_ended`, plus deux nouveaux : `script_step_opened` et `script_step_refused`). La table sert à lire vite. Le journal sert à rejouer et à mesurer. On peut reconstruire la table à partir du journal.

3. **Trois sortes de pas, lues dans le script du catalogue** (chaque étape y garde l'accès offert ou payant de sa structure, ADR 0064 § 3 ; le prix ne vient que du catalogue) :
   - **étape offerte** : part sans prix. Elle sert à faire monter, elle ne compte pas comme une offre pour le délai ;
   - **étape payante** : un pack au prix du catalogue. C'est la seule à compter comme une offre (`offer_made`, `lastOfferAt`) ;
   - **pont offert** : relie deux étapes. Il part après l'étape juste avant, achetée si elle est payante, offerte sinon (Charles, 12/11), et il n'est jamais facturé.

### B. Qui décide quoi

4. **Le code choisit, la voix dit** (`agent/domain/script-run.ts`, `nextScriptStep`). À chaque message du fan, le code part de l'état du déroulé, de la politique d'offre et du moment. Il rend une seule décision fermée :
   - `none` : rien à proposer, la voix fait la conversation ;
   - `start` : ouvrir un script, avec le script choisi et sa première étape ;
   - `send_step` : envoyer l'étape suivante (offerte, payante ou pont), avec son prix s'il y en a un ;
   - `wait` : une étape est partie et attend son ouverture ou son achat. La voix fait vivre la conversation sans reproposer ;
   - `after_refusal` : il vient de refuser. Ce qui suit relève de P6-02 (sa réaction est réglée hors dépôt), jamais une nouvelle étape ;
   - `end` : le script est fini (tout acheté, refusé, ou repris par un humain).

5. **Le prix vient du catalogue, jamais du modèle.** La voix reçoit, dans un bloc typé `<script_step>`, le type de pas, la consigne de l'étape, le prix exact et la fiche des médias. Elle n'invente ni prix, ni contenu, ni étape. Les gardes existantes (pas de remise, pas d'annonce d'un média qui ne part pas) restent bloquantes.

6. **Le choix du script** (`start`) se fait en deux temps (Charles, 12/11) :
   - **le code fixe la liste permise** : scripts du catalogue du bon moment (Jour ou Nuit, sur son horloge à elle), jamais joués à ce fan, tous médias décrits et validés (ADR 0083), sans rien qui touche les limites de sa persona ;
   - **le cerveau choisit dans cette liste** celui qui colle le mieux à la conversation, en lisant la description du déroulé de chaque script (ce dont il parle, ce qui le chauffe). Il rend l'identifiant d'un script de la liste ; le code vérifie qu'il y est, sinon aucun script ne part (fail closed). Les tests et les évals fixent la réponse du cerveau pour rester reproductibles.

7. **La politique reste la porte.** `start` et toute étape payante passent par `offerDecision` (délai entre scripts, désir, âge confirmé, gel, risques). Une étape offerte ou un pont d'un déroulé déjà ouvert n'y passe pas, mais il est retenu si le fan est gelé, fragile, « ne plus lui écrire » ou en mode soin (ADR 0088).

### C. Comment on avance

8. **Achat vu** (`sale_detected` relié au pack de l'étape, ou un achat simulé dans les tests) : l'étape passe à « achetée ». Le pas suivant devient permis : le pont s'il y en a un, puis l'étape suivante. L'aftercare de P6-02 passe avant.

9. **Refus** (le cerveau lit un refus clair, ou il ignore l'étape payante et parle d'autre chose deux messages de suite : c'est un refus, Charles, 12/11) : l'étape passe à « refusée » et le déroulé à `refused`. Le pack refusé n'est jamais reproposé. Un refus, dit ou par silence, ouvre `after_refusal` : elle réagit comme la persona le ferait (P6-02, réglé hors dépôt).

10. **Sans réponse** : une étape payante non ouverte au bout du délai de relance (`post_offer`, P6-02) a droit à une relance courte au plus, puis le déroulé passe à `stalled`. On ne reprend jamais un déroulé `stalled`. Le script suivant attend le délai entre scripts.

11. **Un humain reprend** (`takeover_started`) : le déroulé passe à `closed_by_human`. Ce que le chatteur envoie ensuite dans Reveal n'est pas suivi par ce déroulé.

12. **La même session.** L'étape suivante n'est proposée que pendant la même session chaude, quand la note de désir est encore au-dessus du seuil d'ouverture. Un déroulé ne reprend jamais une autre session (Charles, 12/11 : sinon on voit que les médias sont enregistrés à l'avance) : à la fin de la session chaude, il passe à `stalled`. Si le fan revient chaud plus tard, c'est un nouveau script, après le délai entre scripts.

### D. Médias et catalogue

13. **D'une structure à un script vendable** (relecteur Médias). Une structure figée (ADR 0056), tournée, décrite et téléversée dans Reveal (SC-06) devient un script du catalogue (P6-01). Chaque étape et chaque pont gardent leur clé de segment. Le déroulé ne lit que le catalogue : un script qui existe seulement dans l'atelier ne se propose pas.

14. **Ce qui reste à P6-01 (Bilan, puis Agent) :** la lecture des scripts, packs et prix dans Reveal, `sales` et la relation achat → pack, ainsi que `lastOfferAt` branché sur l'historique. Tant que P6-01 n'est pas là, le déroulé tourne sur un catalogue fictif (playground, évals, tests).

15. **Correction 8 (voix) :** le bloc `<script_step>` du § 5 est ce que la correction 8 demandait. Il se branche ici.

### E. Tester sans connecteur

16. **Tout le déroulé est du domaine pur** : un état plus un événement donnent un nouvel état et une décision. Les tests unitaires couvrent chaque transition.
    - Côté intégration, on utilise un catalogue fictif et des achats simulés par `FakeReveal`.
    - Au playground, la créatrice joue le fan et peut faire « /achète » ou « /refuse ».
    - Dans les évals, des scénarios longs vont du premier message à l'aftercare (correction 4).

### F. Rythme des offres

17. **Compteurs d'offres** : aucun (Charles, 12/11). Seuls le délai entre deux scripts et la relance du désir (décision du 17/10) règlent le rythme ; les compteurs « 3 offres par jour » et « 5 sans achat » ne reviennent pas.

## Conséquences

- L'agent sait vendre un script étape par étape, sans jamais choisir un prix ni rejouer un pack.
- Une table nouvelle `script_runs` (FORCE RLS, migration 0171), avec deux types d'événements de plus.
- Prompts : la voix reçoit `<script_step>`, le cerveau garde son rôle de lecteur (refus, signal d'achat). Aucune règle de vente n'entre dans un prompt.
- Les méthodes de l'agence (consignes réelles, prix, textes) restent hors dépôt : le dépôt ne montre que le mécanisme et un script fictif.
- Évals de vente : premier achat, escalier dans la même session, refus à la deuxième étape, étape non ouverte, script de nuit refusé en plein jour, tout acheté.

