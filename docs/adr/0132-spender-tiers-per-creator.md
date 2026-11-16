# 0132. Paliers de dépense : l'IA est plus proche et plus attentive avec ceux qui ont beaucoup dépensé, jamais plus pressante ; un prix plus haut par une branche de palier

Statut : accepted (« ok 0132 » de Charles le 16/11/2026 à 15 h 38, heures de Paris dans tout le texte, fil « Adapter l'IA aux gros dépensiers » ; demande de Charles du 16/11/2026 à 14 h 56 ; relue par Agent, Bilan et Scripts à branches)
Date : 2026-11-16
Précise : ADR 0085 (fiche du fan, § 4 la tête lue chez la plateforme, § 9 la proposition « fragile »), ADR 0086 (panneau copilote), ADR 0088 (mode soin), ADR 0098 et 0112 (scripts, branches selon la dépense), ADR 0021 (rester en personnage), ADR 0063 (ce que voit la créatrice), ADR 0131 (goûts du fan), ADR 0128 (ménager les scripts). **Amende l'ADR 0112 § 2** (« jamais les mêmes médias à deux prix ») pour la seule branche de palier du § 12 bis, sur décision de Charles du 16/11/2026 à 15 h 10.

## Contexte

Le 16/11/2026, Charles demande que l'IA se comporte autrement avec les fans qui ont beaucoup dépensé chez une créatrice : « plus proche d'eux, plus petite amie, […] pas amoureuse, mais très intéressée, encore plus aux petits soins ». Des outils du marché proposent déjà des paliers de dépense (un montant, des réglages à part pour les fans qui l'ont atteint, jusqu'à cinq paliers, un compteur de fans par palier), certains avec des prix plus hauts pour ces fans.

Aujourd'hui, tous les fans d'une créatrice ont la même IA. Ce que le code sait de la dépense :

- le connecteur Reveal lit la dépense totale du fan chez la créatrice (`conversations.stats` → `getFanProfile.totalSpentMinor`, et `memberTotalSpent` dans la liste des conversations), avec son achat le plus haut et la date du dernier ;
- l'agent n'en voit qu'une phrase de situation (« Il a déjà dépensé … € chez elle »), calculée sur les messages payés stockés par Impera, et rien n'en dépend ;
- une branche de script peut déjà dépendre de la dépense passée, vers le haut seulement (ADR 0112 § 2 et § 5) ;
- la politique sait geler les ventes (`salesFrozen`, dont `money_trouble`), et le module `supervision` propose « Le marquer fragile ? » quand l'attachement est fort et les dépenses montent vite (ADR 0085 § 9).

La méthode de l'agence pose des règles que ce sujet ne doit pas casser : la relation avant la vente, le fan n'est pas un portefeuille ; jamais de remise ni de prix réduit, pour personne ; jamais de « je t'aime » ni de oui à un rendez-vous concret ; elle ne dit jamais être une IA (ADR 0021). Un gros dépensier est aussi, plus souvent qu'un autre, quelqu'un qui dépense au-delà de ses moyens ou qui s'attache trop : c'est le cas qu'il faut voir avant tout.

## Décision

### A. D'où vient la dépense

1. **La source est la plateforme, jamais un modèle** (relecture Bilan, 16/11/2026). La dépense qui place un fan dans un palier se calcule sur le **registre des ventes** (`platform_sales`, alimenté par l'API CRM de la plateforme, ADR 0050 et 0078) : ses ventes chez la créatrice, moins leurs remboursements, ligne à ligne, par l'identifiant du fan chez la plateforme. Exacte, nette des remboursements et rejouable. Le montant qui compte est **`gross_incl_vat_minor`**, ce que le fan a payé : le seul comparable au repli, pour qu'un même fan ne change pas de palier selon la source. **Le registre ne fait foi que si sa couverture remonte au début du compte** (date de début de couverture gardée par compte) ; sinon il sous-compterait tout ce qui a été acheté avant, et c'est le repli qui sert. Une ligne sans identifiant de fan (`platform_fan_id` nul) ne compte pour aucun palier, et leur nombre est suivi par un indicateur, pour voir si la source perd des ventes. **Repli** quand le flux des ventes n'est pas branché pour la créatrice : la dépense totale de la plateforme (Reveal : `totalSpent` de `conversations.stats`, en centimes d'euro, déjà lue par `getFanProfile`), gardée en base avec sa date (la dernière dépense par fan du lot a, pas la mémoire du worker), relue sur un achat ou à l'ouverture de la fiche quand elle a plus de 15 minutes, jamais à chaque tour de l'agent ; la déduction des remboursements par Reveal n'est **pas vérifiée**, et la fiche dit toujours quelle source a servi (« registre des ventes » ou « dépense lue chez Reveal »). La somme des messages payés stockés par Impera (l'actuel `situation.spentCents`) n'est plus utilisée pour le palier : elle ignore tout ce qui a été acheté avant le premier relevé. Aucun modèle ne devine ni n'écrit ce chiffre (ADR 0085 § 4). **Une seule dépense pour tout le code** (relecture Scripts à branches) : la **dépense lue** (à vie, remboursements déduits, avec son repli) est celle que lisent le palier, la condition de branche sur la dépense (ADR 0112 § 5) et la phrase de situation de l'agent, pour qu'une branche et le palier ne se contredisent jamais pour le même fan.

2. **Les listes intelligentes de Reveal** (dont celle qui range un fan parmi les gros dépensiers) ne sont **jamais** la source du palier : leurs règles sont réglées chez Reveal, hors d'Impera, et peuvent changer sans qu'on le sache. Une capture déjà relevée (16/11, Bilan) montre la liste des listes d'un compte avec leurs règles (statique ou dynamique ; conditions « intéressé », « a dépensé plus de », « a dépensé moins de » un montant), leur nombre de fans et les appartenances d'un fan : les lire ne demande pas de nouvelle capture, mais le connecteur ne le fait pas encore. Une fois lues, elles s'affichent en lecture sur la fiche, à côté du palier, et l'écran des paliers peut montrer leurs seuils pour aider l'agence à régler les siens.

3. **Dépense à vie.** Le palier se calcule sur toute la dépense du fan chez la créatrice, comme Reveal l'affiche (Charles, 16/11/2026 à 15 h 15). Il ne redescend que si un remboursement fait passer la dépense sous le seuil.

### B. Les paliers, réglés par créatrice

4. **Jusqu'à cinq paliers par créatrice**, saisis dans le CRM (Créatrices › fiche › « Paliers de dépense ») par le propriétaire ou un manager. Chaque palier a un nom choisi par l'agence, un seuil en unités mineures de la devise de la plateforme (entier, ADR 0011) et ses réglages (§ C). Les seuils sont strictement croissants ; un fan sous le premier seuil n'a pas de palier et garde l'IA de tous les fans. Aucun seuil ni aucun nom par défaut dans le dépôt : sans palier saisi, rien ne change. Les valeurs vivent en base, par créatrice (RLS par `creator_id`), jamais dans le dépôt ni dans un prompt.

5. **Le fan bascule tout seul.** À chaque nouvelle dépense lue, le code recalcule son palier ; un changement écrit un événement (`fan_tier_changed`, avec l'ancien et le nouveau palier, sans montant dans les logs) et vaut dès la réponse suivante. Un humain ne pose pas un palier à la main : il change les seuils, ou il pose un drapeau (§ D).

6. **Compteur.** L'écran des paliers montre, pour chacun, le nombre de fans qui y sont aujourd'hui, et le nombre sans palier. L'agence voit les nombres exacts ; la créatrice ne voit ni les paliers ni leurs réglages (§ 15).

### C. Ce que le palier change pour l'IA

Le palier ne change que la façon d'être avec lui. Chaque effet est soit une valeur que le code lit, soit un texte versionné que le code choisit ; aucune règle de vente n'entre dans un prompt (règle 3 du dépôt).

7. **Le registre, dans une liste fermée** (`SpenderRegister`, `@impera/contracts`) : `warm` (chaleureuse, comme aujourd'hui), `close` (proche : elle se souvient, elle demande des nouvelles, elle lui dit qu'il lui a manqué) et `girlfriend` (petite amie : complice, tendre, attentionnée ; elle lui montre qu'il compte, sans jamais lui reprocher une absence ; le « nous » est celui de la conversation, jamais celui d'un couple). Chaque palier choisit un registre. **C'est le code qui choisit le registre** et ajoute son texte après le prompt de la voix, dans un bloc typé, jamais le cerveau. Le texte de chaque registre est un prompt versionné (`voice/register-*.md`), revu comme les autres prompts et testé en évals ; il dit ce qui se fait, jamais un prix, un rythme ou une permission. **Le cerveau ne reçoit ni le palier ni son nom** comme argument de vente : seulement le registre (relecture Agent), pour ne pas rouvrir la porte au fan vu comme un portefeuille.

8. **Attention et mémoire.** Dès `close`, le cerveau reçoit plus de la fiche du fan (ADR 0085) : ses `life_events` datés, ses passions, ce qu'il aime chez elle, avec la consigne de revenir sur un événement passé (« et ton examen ? ») au plus une fois par session et seulement quand le moment s'y prête. C'est le code qui choisit les cases transmises, selon le registre ; les cases réservées au cerveau (`payday`, `attachment`, `moods`) n'atteignent jamais la voix, palier ou pas (ADR 0085 § 9).

9. **Rythme et pression de vente : jamais plus, souvent moins.** Un palier peut **allonger** les délais de vente de la créatrice (un multiplicateur ≥ 1 : le délai entre deux offres et la pause après un achat de l'ADR 0128, `after_purchase_hours`) et **réduire** le nombre de relances commerciales ; il ne peut ni les raccourcir, ni en ajouter, ni baisser les seuils de la note de désir, ni avancer le délai de sexualisation ou le KYC minimum. Le code refuse à l'enregistrement un réglage qui irait plus vite que celui des fans sans palier.

9 bis. **Ce que le palier ne touche pas dans le choix du script** : ni la correspondance des goûts, ni le classement, ni le recul d'intensité de l'ADR 0131 (§§ 6 et 7). Il n'agit sur la vente que par les branches de palier (§ 12 bis) et par le § 9.

10. **Priorité de réponse.** Quand plusieurs fans attendent, les tâches de l'agent d'un fan à palier passent devant (priorité de la file, ADR 0006), et ses lignes de « À traiter » sont rangées avant celles d'un fan sans palier de même gravité. Le délai de réponse et la frappe réaliste ne changent pas : une réponse instantanée trahirait la machine. La priorité ne passe **jamais** devant un passage à l'humain pour sécurité, une conversation en doute d'âge ou en mode soin, et un plafond d'attente garantit qu'un fan sans palier n'attend jamais indéfiniment derrière les autres.

11. **Une consigne libre par palier**, 1 000 caractères au plus, écrite par l'agence (attentions, sujets qu'il aime qu'on lui rappelle, manière de lui parler). Elle entre dans le prompt de la voix et du cerveau dans un bloc délimité et typé (`<tier_note>`), après la persona et sous les règles du code. Elle est refusée à l'enregistrement si elle contient un montant, un pourcentage, un lien ou un contact. Elle ne peut rien élargir : ce que le code interdit reste interdit, quelle que soit la phrase.

### D. Ce que le palier ne change jamais

12. **Les bornes, dans le code et testées.**
    - **Prix** : jamais de remise, de prix réduit ni de code promo, à aucun palier (règle de l'agence pour tous). Un prix ne monte que par le § 12 bis.
    - **Gardes** : `ai_disclosure`, `love_declaration` (aucun « je t'aime »), `meeting_promise` (jamais de oui à un rendez-vous concret ; le « pourquoi pas un jour » reste permis), paiement hors plateforme, contact, `care`. Une garde **bloquante** nouvelle, `exclusivity_promise`, lue pour **tous** les fans et pas seulement en `girlfriend` : « je ne parle qu'à toi », « t'es le seul », « on est ensemble / en couple », « notre avenir », « je t'attends » au sens réel. « Je suis à toi » en plein échange intime reste permis : c'est du jeu, comme la rêverie au conditionnel. Le code entre dans `GUARD_CODES`, avec ses tests et une éval par registre.
    - **La persona** : ses limites, dégoûts et règles strictes (ADR 0079) restent le plafond ; aucun registre ni consigne ne les élargit.
    - **La sécurité** : âge, mineur possible, mode soin (ADR 0088), drapeaux du fan, budget IA, tout reste au-dessus du palier.

12 bis. **Prix plus haut par palier** (décision de Charles, carte du 16/11/2026 à 15 h 10 ; amende l'ADR 0112 § 2). Règles :
    1. Le prix plus haut passe **seulement par une branche de palier** du script, posée chez la plateforme avec son prix. La branche porte la condition `spender_tier_at_least { tierId }`, ajoutée à la liste fermée de l'ADR 0112 § 5 à côté de `spent_at_least` : l'agence change un seuil, les branches suivent. Un palier supprimé laisse le script proposable par sa branche par défaut : avertissement ambre `branch_tier_unknown` à l'écran (« Palier supprimé : cette branche n'est plus jamais choisie »), pas un manque, et la branche n'est jamais choisie.
    1 bis. **Saisie à la création du script dans Impera** (Charles, 16/11/2026 à 15 h 11) : dans l'éditeur de script (ADR 0112, lot 4 des branches), chaque étape payante a son **prix normal** et, pour chaque palier choisi, un **prix gros dépensier** facultatif, côte à côte. **Impera ne crée ni ne modifie de script chez Reveal** (aucune capture d'écriture ; l'ouvrir demande une ADR de connecteur à part) : l'éditeur prépare les deux branches, l'agence pose chez Reveal la copie de l'étape au prix gros dépensier, et l'import (ADR 0099) la rattache comme branche de palier. Une branche préparée sans sa copie chez Reveal est un manque à l'écran, et le fan reçoit la branche par défaut. Le prix décidé est celui de chaque branche : « prix changé ou remise chez Reveal = bloquer et alerter » (ADR 0098 § 5) compare chaque branche à son propre prix et reste inchangée.
    2. Une branche de palier **peut reprendre les médias de la branche par défaut** de la même étape (c'est l'amendement de 0112 § 2, et l'exception à `media_twice` entre branches d'un rang). Plusieurs branches de palier peuvent reprendre les mêmes médias ; un palier plus haut n'est jamais moins cher qu'un palier plus bas, sinon c'est un manque. Toute autre paire de branches garde la règle : jamais les mêmes médias à deux prix.
    3. Le prix d'une branche de palier est **strictement plus cher** que celui de la branche par défaut et **au plus trois fois** celui-ci. Le prix étant posé chez Reveal puis importé, le contrôle est un manque du script recalculé à chaque import (`branch_tier_price_out_of_range`) : le script n'est pas proposable tant qu'il existe.
    4. **Jamais de retour au prix de base** pour un fan qui refuse le prix de son palier : ce serait une remise. Le refus suit la règle de tous (refus final, pas de prix réduit).
    5. **Le premier prix qu'un fan a vu pour une étape reste le sien**, à tous ses passages (rejeu de l'ADR 0128 compris), dans les deux sens : un fan qui monte de palier garde le prix déjà vu, un fan qui redescend après un remboursement garde le prix de palier (le prix de base serait une remise). Les médias d'une branche de palier n'entrent pas dans un message de masse où d'autres fans les verraient à un autre prix.
    6. Fragile, ventes gelées ou mode soin : aucune vente, donc aucun prix de palier (§ 13).
    7. **À vérifier par Bilan sur le fan « test »** avant le lot a bis : Reveal accepte-t-il le même média dans deux scripts à deux prix, et un achat débloque-t-il le média pour l'autre script ? Si Reveal refuse, le § 12 bis attend une autre voie, par une nouvelle ADR. Non vérifié au 16/11 (Bilan) : le test crée un script et fait un vrai achat sur « test », donc il attend le mot de Charles dans le fil qui l'exécute. La lecture garde déjà le prix de chaque branche, et la garde « prix changé » compare chaque branche à son propre prix ; que l'import (#801) garde le script de chaque branche reste à vérifier. Envoyer un média du coffre à un prix choisi au message, hors script, n'est pas possible aujourd'hui (le connecteur refuse tout prix).

13. **Le gros dépensier en difficulté passe à un humain.** Parce qu'un palier rend l'IA plus proche, il rend aussi plus grave le fait de vendre à quelqu'un qui ne devrait pas acheter. Pour un fan à palier :
    - **Signes lus par le cerveau, sur les risques existants** (relecture Agent) : `money_trouble` (il dit dépenser au-delà de ses moyens : dettes, découvert, crédit, loyer, « je ne devrais pas » ; ou il demande qu'on arrête de lui proposer), `distress` (ouvre le mode soin), et un seul risque nouveau, `dependency` (il dit qu'elle est la seule personne qui compte, ou qu'il s'isole pour elle). Pour un fan sans palier, `dependency` ouvre aussi la proposition « fragile ». **Signe lu par le code** : sa dépense des 7 derniers jours dépasse un multiple de sa moyenne hebdomadaire (même calcul que la proposition « fragile », ADR 0085 § 9).
    - **Effet, en code** : ventes gelées tout de suite (`salesFrozen`, raison `money_trouble` pour `money_trouble` et `dependency`, ou `distress` qui ouvre le mode soin de l'ADR 0088), ligne rouge « Gros dépensier en difficulté : un humain décide » dans « À traiter », et la proposition « Le marquer fragile ? ». Aucun script, aucune relance, aucun chouinage tant qu'un humain n'a pas levé le gel ; le jour de paie ne le lève jamais (ADR 0085 § 9).
    - **Le ton** : l'IA ne devient pas froide d'un coup, mais un fan fragile (avec ou sans palier) ou aux ventes gelées garde au plus le registre `close`, jamais `girlfriend`, et la consigne libre du palier n'est plus lue. Proximité oui, dépendance non.

### E. Ce que voit l'équipe

14. **Sur la fiche du fan et dans le copilote.** La tête de la fiche (ADR 0085 § 4), dans le Suivi du CRM et dans le panneau de l'extension (ADR 0086), montre le palier par son nom, sa dépense lue et sa date, le registre en vigueur, et en dessous la consigne libre du palier, pour que le chatteur humain parle au fan comme l'IA le fait. Les listes intelligentes de Reveal, si elles sont lues, en lecture à côté (§ 2). Un fan à palier dont le registre est borné par le § 13 le dit en ambre (« Registre limité : fragile »).

15. **Qui voit quoi.** Propriétaire, managers et chatteurs qui ont accès à la créatrice (ADR 0024, 0025). La créatrice ne voit ni les paliers, ni leurs réglages, ni le palier d'un fan : c'est une méthode de l'agence (ADR 0063). Aucun palier ni montant dans une alerte Telegram, un export ou un log, seulement des codes.

16. **Trace.** Le « Pourquoi » d'un brouillon (playground et conversation côté agence) dit le palier et le registre lus, et si le § 13 les a bornés.

## Partage du travail

| Lot | Contenu | Fil |
|---|---|---|
| a | Contrats (`SpenderTier`, `SpenderRegister`, vue de la tête de fiche), migration (paliers par créatrice, dernier palier et dernière dépense par fan, numéro au signal), dépense nette depuis le registre des ventes et repli `totalSpent` en cache, `fan_tier_changed`, routes de réglage et isolation | Bilan (connecteur, db) + Agent (fans) |
| a bis | Condition `spender_tier_at_least`, exception de `media_twice` pour la branche de palier, manque `branch_tier_price_out_of_range`, avertissement `branch_tier_unknown`, premier prix vu gardé | Scripts à branches (lot 2 des branches) |
| b | Registres versionnés (choisis par le code), garde bloquante `exclusivity_promise` pour tous les fans, cases de la fiche transmises par registre, bornes du § 9 et du § 12, priorité de file, consigne libre en bloc typé, évals par registre (fans inventés) | Agent |
| c | Risque nouveau `dependency` (et sa proposition « fragile » sans palier), signes du § 13 sur les risques existants, gel et ligne rouge, registre borné | Agent (+ supervision) |
| d | Écran « Paliers de dépense » avec compteur ; palier dans la fiche du fan et le copilote | Design / Extension |
| e | Lecture des listes intelligentes de Reveal (route déjà relevée) | Bilan |

## Questions à Charles (toutes tranchées)

1. ~~Prix plus hauts pour les gros dépensiers~~ : **tranché par Charles le 16/11/2026 à 15 h 10, oui** (§ 12 bis), contre la recommandation (risque de perte de confiance des meilleurs clients s'ils comparent les prix), avec les règles du § 12 bis pour le limiter.
2. ~~Dépense à vie ou récente~~ : **tranché par Charles le 16/11/2026 à 15 h 15, à vie** (§ 3).

## Conséquences

Positives :
- Les fans qui comptent le plus sont reconnus, se sentent mieux traités, et l'équipe humaine parle comme l'IA grâce au palier affiché.
- Tout effet est borné par le code : on peut dire à tout moment ce qu'un palier change, et rien de ce qu'il change ne pousse à vendre plus vite.
- Le cas le plus risqué (gros dépensier qui ne peut plus suivre) devient visible et passe à un humain.

Négatives, à surveiller :
- Un registre plus proche peut nourrir un attachement : c'est pourquoi le § 13 existe. À relire sur les premières semaines de réel, avec les propositions « fragile ».
- Sans flux des ventes, la dépense lue chez Reveal peut avoir 15 minutes de retard, et rien ne prouve qu'elle déduit les remboursements ; l'écran le dit.
- La consigne libre est du texte : le code ne peut pas tout vérifier. Elle est bornée par ce qu'elle ne peut pas élargir, et revue comme une donnée de l'agence.
- Le prix plus haut par palier peut se voir (fans qui comparent, captures partagées) et coûter la confiance de ceux qui rapportent le plus. À mesurer : taux de refus et départs des fans à palier avant et après (ADR 0129).
- Trois registres sont un choix ; en ajouter un passe par une PR et ses évals.

## Alternatives rejetées

- **Prendre les listes intelligentes de Reveal comme source** : règles réglées hors d'Impera, invisibles au code, et propres à une plateforme (ADR 0003).
- **Laisser le modèle juger qui est un gros dépensier** : un chiffre que la plateforme connaît ne se devine pas.
- **Remise ou bonus de fidélité pour les gros dépensiers** : contraire à la règle de l'agence, jamais de prix réduit.
- **Changer le prix chez Reveal fan par fan depuis Impera** : une écriture de prix sur la plateforme que personne ne voit, contraire à l'ADR 0098 § 5 ; la branche de palier garde le prix visible dans le script.
- **Plus d'offres ou de relances pour ceux qui achètent** : c'est traiter le fan en portefeuille, et c'est exactement le profil qu'il faut protéger.
- **Un prompt libre par palier sans registre** : une règle de ton vivrait dans un texte que personne ne teste ; le registre est versionné et évalué, la consigne libre ne fait que s'y ajouter.
