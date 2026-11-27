# 0167. Impera crée dans Reveal, sans jamais modifier ni supprimer : dossiers, médias et scripts

Statut : accepted (Charles, 21/11/2026, 20 h 23 heure de Paris, carte « Valides-tu la décision … telle qu’écrite ? », option « Oui, comme écrit » ; choix de Charles, 21/11/2026, 20 h 20 heure de Paris, carte « Autorises-tu Impera à créer dans Reveal : dossiers, médias et scripts ? », option « Oui, création seule » ; texte relu et accepté par Bilan, propriétaire du connecteur, le 21/11 avec six ajouts)
Date : 2026-11-21
Ouvre : l'ADR 0099 § 6 (création d'étapes et de séquences par le connecteur, restée fermée).
Étend : l'ADR 0145 (dossiers par rôle, création de dossier) au dépôt de médias, script ou pas ; l'ADR 0161 § 1 (Impera vers Reveal, jamais l'inverse) à un envoi par le connecteur, à côté de la recopie à la main.
Précise : l'ADR 0018 § 3 (garde d'écriture), l'ADR 0056 § 7 (vers Reveal dans l'ordre).

## Contexte

Un script se prépare dans Impera : médias décrits, étapes, branches, prix (ADR 0112, ADR 0161). Pour qu'il soit jouable, il doit exister dans Reveal. Aujourd'hui, quelqu'un de l'agence le recopie à la main en suivant « À copier dans Reveal », puis la synchronisation le reconnaît. Pour un script à branches avec ses médias, la recopie est longue et source d'erreurs.

Le coffre a le même besoin hors script : créer un dossier d'un rôle donné (ADR 0145) et y déposer des médias, par exemple des vocaux préparés pour l'agent ou une réserve de cadeaux.

La capture du 16/11 a vu les appels nécessaires sans jamais les appeler (`docs/reference/reveal-api-observed.md`, « Non utilisés ») : création d'étape, création de séquence, mise en ordre de ses étapes, création de dossier du coffre, URL de dépôt puis création de média. Leur forme exacte n'a pas été relevée.

## Décision

1. **Création seule, verrouillée dans le port.** Le port du connecteur gagne cinq écritures et seulement celles-ci :
   - `createVaultFolder` ;
   - `uploadMedia` (URL de dépôt, envoi du fichier, création du média dans un dossier) ;
   - `createScriptStep` ;
   - `createScriptSequence` ;
   - `setSequenceSteps`, appelée une seule fois sur une séquence que le même envoi vient de créer.

   Le port n'expose aucune modification ni suppression d'un objet Reveal. Les appels `DELETE` observés ne sont jamais branchés. Ce verrou vit dans le code du connecteur et dans ses tests, jamais dans un prompt ni un réglage. Corriger un script envoyé, c'est en envoyer un nouveau ; l'ancien reste chez Reveal et cesse d'être offert (ADR 0161 § 5).

   Seul un humain déclenche une écriture : le propriétaire, ou un manager actif de la liste de la créatrice. Jamais l'agent, jamais une tâche planifiée de sa propre initiative.

2. **Un drapeau par créatrice, éteint par défaut.** Ces écritures passent par la garde d'écriture du compte (ADR 0018 § 3). Elles demandent aussi leur propre drapeau par créatrice, `revealCreate`, éteint par défaut. Seul le propriétaire l'allume, avec ré-authentification, et chaque allumage ou extinction est tracé. Un interrupteur général, `revealCreateKillSwitch`, que seul le propriétaire coupe, arrête toute écriture ; un envoi en cours s'arrête à l'étape suivante. Garde, drapeau ou interrupteur éteint : refus définitif avant tout appel réseau, sans nouvel essai.

   Les écritures passent par la session Reveal recopiée par l'extension, le même chemin que l'envoi des messages. Jamais de connexion automatique, jamais de mot de passe stocké.

3. **Une clé d'idempotence par écriture.** Chaque écriture porte une clé dérivée de l'objet Impera qu'elle porte : dossier, média du coffre, branche, script préparé dans sa version. Reveal n'a pas de clé d'idempotence. Avant tout nouvel essai, le connecteur relit Reveal pour savoir si l'objet existe déjà, comme `verifySent` à l'envoi (P2-03). Un double clic ou un job rejoué ne crée jamais deux objets.

4. **Un journal de chaque écriture.** Chaque écriture laisse une ligne : créatrice, qui l'a demandée, type d'écriture, clé, objet Impera, identifiant Reveal obtenu, statut, date. Le journal ne garde ni le fichier, ni son nom, ni l'URL de dépôt, ni le texte d'une étape. C'est une table nouvelle : FORCE RLS, REVOKE ALL puis des GRANT explicites ; elle se lit par le propriétaire et les managers actifs de la liste de la créatrice.

5. **L'envoi suit l'ordre du script.** « Envoyer dans Reveal » sur un script « Prêt à copier » :
   1. crée son dossier s'il manque (rôle `script`, ADR 0145) ;
   2. dépose les médias absents du coffre ;
   3. crée les étapes ;
   4. crée la séquence et y range les étapes, branches et conditions comprises.

   Un échec arrête l'envoi, et il reprend là où il s'est arrêté. La synchronisation suivante reconnaît la séquence comme aujourd'hui (ADR 0161 § 6). Rien ne devient jouable sans cette reconnaissance. La recopie à la main reste possible.

   Les médias se déposent un par un, avec une pause entre deux, sous un plafond par heure fixé dans le code du port : un envoi garde un rythme humain côté Reveal.

6. **Dossier et médias hors script.** Le même chemin crée un dossier d'un autre rôle (ADR 0145) et y dépose des médias, sans séquence.

7. **Première écriture réelle sur le mot écrit de Charles.** Rien n'est écrit chez Reveal avant trois conditions :
   - les articles 11 à 13 des CGU sont lus et résumés dans `reveal-api-observed.md` ;
   - la forme des cinq appels est relevée par une capture que Charles fait lui-même ;
   - Charles a donné son mot écrit pour le premier envoi, sur un script et un compte qu'il désigne.

   Avant cela, tout se teste contre `FakeReveal`.

8. **Qui livre quoi.**
   - **Bilan** : le port, les cinq écritures, le drapeau, la clé, le journal, `FakeReveal`.
   - **Coffre / Médias** : création de dossier et dépôt de médias depuis le coffre (§ 6).
   - **Scripts** : « Envoyer dans Reveal » sur le script préparé (§ 5).

   Chacun commence après l'acceptation de cette ADR. Coffre et Scripts commencent après les écritures de Bilan.

## Conséquences

- Un script fait dans Impera peut devenir jouable sans recopie, en un geste.
- Rien de ce qui existe chez Reveal ne peut être abîmé par Impera : au pire, un objet de trop, visible et signalé dans le journal.
- Les scripts corrigés laissent des séquences anciennes chez Reveal ; elles ne sont plus offertes, et leur ménage reste un geste humain dans Reveal.
- Le connecteur porte cinq écritures de plus, chacune avec son test contre `FakeReveal`.
- Risque CGU : si les articles encore à lire interdisent l'automatisation, le drapeau reste éteint pour toutes les créatrices et la recopie à la main reste le chemin.

## Alternatives rejetées

- **Garder seulement la recopie à la main** : lente et source d'erreurs pour un script à branches ; reste possible en secours.
- **Créer, modifier et supprimer** : refusé par Charles ; une erreur effacerait un contenu en vente.
- **Créer le script en référençant seulement des médias déjà dans le coffre, sans dépôt** (choix du 12/11) : ne couvre pas les médias déposés dans Impera ni les dossiers hors script ; élargi ici.
