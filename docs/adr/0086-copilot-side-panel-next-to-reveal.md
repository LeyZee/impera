# 0086. Le panneau copilote : à côté de la conversation Reveal, la fiche du fan d'abord, le brouillon de l'agent ensuite, et c'est le chatteur qui envoie

Statut : accepted (« ok 0086 » de Charles le 08/11/2026, 17 h 11, fil « Concevoir la fiche fan remplie par l'IA », avec sa demande que le panneau aide le chatteur sans le remplacer ni lui faire perdre de temps, § 10 ; demande de Charles du 08/11/2026, 16 h 37, fil « Bilan projet » : « il manque le panneau copilote de l'extension et la note du fan partagée » ; numéro attribué par le coordinateur)
Date : 2026-11-08
Précise : l'ADR 0025 (le chatteur chatte dans Reveal, pendant son shift), l'ADR 0019 (taux en réel), l'ADR 0066 § 7 (l'extension lit avec la session du CRM, écrit avec la liaison par personne) et l'ADR 0085 (fiche du fan). Reprend les fiches `PROPOSED-copilot-extension.md` et `PROPOSED-copilot-api.md` du 17/10, qui deviennent des fiches à numéroter. Ne remplace rien.

## Contexte

Le 17/10, Charles a placé le copilote dans l'extension, à côté de Reveal : le chatteur voit le brouillon de l'agent et choisit Envoyer, Retoucher ou Refuser (revue 08). Deux fiches l'ont décrit, côté API et côté extension, sans ADR ni code. Le 27/10, l'ADR 0025 a fixé que le chatteur chatte dans Reveal avec son propre compte membre, et que Nirvana ne lui ouvre une créatrice que pendant son shift. Le 08/11, l'ADR 0085 a fait de la fiche du fan ce que l'IA remplit et que le chatteur corrige, et l'a placée dans ce panneau.

Ce qui manque pour coder : où vit le panneau, qui envoie le message, comment on sait ce qui est vraiment parti, ce qu'il montre et dans quel ordre, et comment il s'allume par créatrice.

Ce qui bloque tout, quel que soit le choix : Impera ne lit pas encore la conversation Reveal (capture, `docs/runbooks/reveal-capture-express.md`). Sans elle, le panneau ne sait ni quelle conversation est ouverte, ni ce que le fan a écrit.

## Décision

1. **Le panneau latéral de l'extension Impera, rien dans la page Reveal.** Un clic sur l'icône Impera ouvre, sur le côté droit de la fenêtre, le panneau de l'extension (`side_panel`, Chrome et Edge, comme les extensions de Claude ou de ChatGPT), qui reste ouvert pendant que le chatteur écrit dans Reveal. Le popup de l'icône (ADR 0066) reste pour la connexion et les raccourcis : il se ferme au premier clic dans la page, il ne peut pas porter le copilote. Aucun style ni élément n'est injecté dans la page Reveal ; le script de contenu ne fait que lire quelle conversation est ouverte et, au geste du chatteur, écrire dans le champ de saisie. Si le navigateur n'offre pas de panneau latéral, l'extension ouvre la même page dans une petite fenêtre à côté.

2. **Il suit la conversation ouverte.** Quand le chatteur change de conversation dans Reveal, le panneau change de fan, d'après l'adresse ou ce que la capture montre. Une conversation qu'Impera ne connaît pas encore affiche « Impera n'a pas encore lu cette conversation ».

3. **Ce qu'il montre, de haut en bas.**
   1. **Où on en est**, en une ligne : la phase (on fait connaissance, ça chauffe, client), la note de désir en mots (neutre, joueur, chaud), et en rouge une limite qui interdit la vente (ventes gelées, âge contesté, ne pas contacter), en ambre une limite qui la retient (fragile, plafond).
   2. **La fiche du fan** (ADR 0085) : la tête lue chez Reveal (dépenses, dernier achat, scripts déjà envoyés), puis les trois groupes, avec la source et l'âge de chaque valeur, et la correction en un geste.
   3. **Le brouillon de l'agent**, quand la créatrice a le brouillon allumé (§ 6) : ses bulles, et les trois gestes.
   Le panneau garde la fiche visible quand il n'y a pas de brouillon : c'est la note du fan partagée, utile même quand l'agent ne propose rien.

4. **C'est le chatteur qui envoie, dans Reveal.**
   - **Envoyer** (`a`) : l'extension place le texte dans le champ de saisie de Reveal, bulle par bulle ; le chatteur relit et appuie lui-même sur Envoyer dans Reveal. Si le champ ne se laisse pas écrire, le texte part dans le presse-papiers avec « Colle dans Reveal ».
   - **Retoucher** (`e`) : il modifie dans le panneau, puis même chemin qu'Envoyer.
   - **Refuser** (`r`) : une raison de la liste fermée du playground et une note facultative ; rien n'est placé, il écrit sa propre réponse.
   L'extension ne clique jamais sur Envoyer à sa place, et la garde d'écriture du connecteur (ADR 0018 § 3) reste fermée. Le message part sous le compte membre du chatteur : pour Reveal, pour la paie et pour la relecture de ses messages (ADR 0052), c'est son message, comme le veut l'ADR 0025 (une vente revient au membre qui tenait la conversation).

5. **Ce qui est parti fait foi, pas le clic.** Quand le connecteur lit le message sortant, l'API le rapproche du brouillon de cette conversation : identique, c'est un brouillon validé ; différent, c'est un brouillon corrigé, avec le texte réellement envoyé ; rien dans les 15 minutes, le brouillon expire. Le panneau ne dit « Envoyé » qu'après ce rapprochement. Chaque verdict écrit une note de calibrage `live` dans la même transaction (taux en réel, ADR 0019). Un message rapproché d'un brouillon ne met pas la conversation en main humaine (ADR 0025) ; un message qui ne ressemble à aucun brouillon, si.

6. **Deux interrupteurs par créatrice, dans Créatrices › (elle) › Agent.** « Fiche du fan dans l'extension » (allumé par défaut dès que le lot (a) de l'ADR 0085 est livré) et « Brouillons de l'agent dans l'extension » (éteint par défaut). On peut donc donner la fiche aux chatteurs sans leur imposer les brouillons d'un agent pas encore entraîné. Les deux ne changent rien au mode de l'agent (Automatique, Copilote, Arrêt), qui reste le bouton unique du CRM (ADR 0019).

7. **Seulement pendant le shift.** Le panneau ne montre une créatrice qu'à un chatteur en poste sur elle, marge comprise, par la même garde du serveur (`shiftCreatorIds`, ADR 0025). Hors shift : « Tu n'es pas en poste sur cette créatrice. » Le propriétaire et un manager actif ne sont pas bornés. Chaque fiche ouverte entre au journal d'audit, sans son contenu (ADR 0025). La créatrice n'a pas de panneau (ADR 0063).

8. **Qui est là, et comment il écrit.** Le panneau lit la personne avec la session du CRM (ADR 0066 § 2). Les écritures (verdict, correction de la fiche) passent par la liaison par personne de l'extension (ADR 0066 § 7, VEI-01), élargie à ces deux envois ; jamais par le cookie du CRM, jamais avec une clé IA dans l'extension. Rejouer un verdict ne crée rien (clé d'idempotence par brouillon).

9. **Le brouillon arrive vite ou s'efface.** Le panneau lit le brouillon toutes les 5 secondes tant qu'il est visible, sans flux ouvert. Pendant que l'agent écrit, il affiche « L'agent écrit… ». Un brouillon dépassé par un nouveau message du fan est retiré et refait. Si le délai entre le message du fan et le brouillon dépasse 30 secondes en médiane sur une journée, le Dashboard le dit au propriétaire : un chatteur n'attend pas.

10. **Un copilote qui fait gagner du temps, jamais qui en coûte.** Le chatteur passe d'une conversation à l'autre en quelques secondes ; le panneau le suit à ce rythme. En règles vérifiables :
    - **Lisible en trois secondes** : la ligne « où on en est » et l'essentiel de la fiche (prénom, âge, ville, ce qui l'excite, ce qu'il ne veut pas, la dernière chose qu'il a racontée) tiennent sans défiler sur un écran de portable ; le reste de la fiche est replié par groupe, ouvert d'un geste, et le panneau garde ce choix.
    - **Zéro geste pour suivre** : changer de conversation dans Reveal change le fan en moins d'une seconde, sans clic dans le panneau.
    - **Un geste pour envoyer** : `a` place le texte dans le champ de Reveal et y remet le curseur ; il ne reste au chatteur qu'à appuyer sur Entrée. Aucune fenêtre de confirmation, aucune modale sur les trois gestes. Les raccourcis marchent dès que le panneau a le focus, et le panneau ne prend jamais le focus de Reveal tout seul.
    - **Rien ne bouge sous ses yeux** : une valeur nouvelle de la fiche s'ajoute sans décaler ce qu'il lit, avec une marque discrète « nouveau » ; un brouillon qui arrive ne pousse pas la fiche.
    - **Aucun bruit** : ni son, ni notification, ni badge clignotant ; le rouge est réservé à une limite qui interdit la vente.
    - **Mesuré** : le Dashboard montre, par chatteur, le temps entre le message du fan et sa réponse, avec et sans le panneau. Si le panneau ne le rend pas plus rapide au bout de deux semaines d'usage, on le reprend avant d'allumer les brouillons.
    - **Vu avant fusion** : les captures du panneau (Nuit et Jour) passent devant Charles, et un chatteur l'essaie sur le bac à sable avant la première créatrice réelle.

## Lots

- (a) API : contrat `copilot.ts` (brouillon en attente, verdict), routes `GET /v1/copilot/conversations/:platformConversationId/draft` et `POST /v1/copilot/drafts/:draftId/verdict`, rapprochement du message sortant, note `live` (migration à demander : `draft_id`, `source`), les deux interrupteurs. Fil Bilan pour les routes et la migration, fil Agent pour le rapprochement.
- (b) Extension : le panneau latéral, le suivi de la conversation ouverte, la fiche (lot (d) de l'ADR 0085), puis le brouillon et ses gestes, contre `FakeReveal`. Fil Extension. Captures Nuit et Jour, PC.
- (c) Le délai du brouillon au Dashboard. Fil Agent.
Tout passe d'abord dans le bac à sable (ADR 0075) ; aucun envoi à un vrai fan.

## Conséquences

Positives :
- La fiche du fan arrive chez le chatteur sans attendre que l'agent soit bon : c'est le premier gain réel.
- Aucune écriture vers Reveal n'est ouverte : le chatteur reste l'auteur, la paie et la relecture ne changent pas.
- Le taux en réel se mesure sur ce qui est parti, pas sur un clic.

Négatives, à surveiller :
- **Rien ne marche sur Reveal avant la capture** : ni le suivi de la conversation, ni le rapprochement, ni le champ de saisie.
- Un chatteur peut coller sans lire. Le message est le sien, relu comme les autres (ADR 0052) ; la formation le dit.
- Écrire dans le champ de Reveal dépend de sa page : un changement chez eux peut casser le placement. Le repli du presse-papiers reste.
- Un brouillon lent fait taper le chatteur lui-même, et le taux en réel ne bouge pas. Le délai est montré au propriétaire (§ 9).
- Le panneau latéral d'Edge est à vérifier sur le PC de Charles avant le lot (b).

## Alternatives rejetées

- **Un bouton qui envoie par le membre « bot »** : il faut ouvrir l'écriture sur un vrai compte, le message ne porte plus le nom du chatteur, et la paie doit alors trancher qui a vendu. Possible plus tard, par une ADR, quand l'agent écrira seul.
- **Un panneau injecté dans la page Reveal** : fragile, et contraire à la règle de l'extension (rien de stylé dans Reveal).
- **Valider dans le CRM (Suivi) puis copier dans Reveal** : deux onglets, et le chatteur perd la conversation des yeux.
- **Allumer les brouillons pour tout le monde d'un coup** : un agent pas encore entraîné ralentirait les chatteurs ; l'interrupteur par créatrice laisse commencer par la fiche.
- **Dire « Envoyé » au clic** : le taux compterait des messages jamais partis ou retouchés ensuite dans Reveal.
