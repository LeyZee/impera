# 0043. Chatteur : ventes saisies une à une, rapport de fin de shift contrôlé par le code, retours de l'IA sans effet sur la paie

Statut : proposed (cadrage avec Charles le 02/11/2026, fil « Concevoir les espaces modèle et chatteur mobiles » ; à accepter par Charles)
Date : 2026-11-02
Précise : l'ADR 0023 § Une seule source de revenus par compte et § Rôles (validation des rapports), et la fiche EQ-03 (le rapport porte un montant déclaré). Ne change ni le calcul de la paie, ni ses états, ni son immuabilité (ADR 0023 § Paie, 0032, 0035).

## Contexte

Aujourd'hui (EQ-03), le chatteur déclare à la fin de son shift un **montant total**, un commentaire et un incident ; le propriétaire ou un manager actif valide chaque rapport. La paie lit les rapports validés tant que le connecteur Reveal ne lit pas les ventes (source « déclarée », ADR 0023).

Le 02/11, Charles a demandé (document de cadrage du 02/11, questions D3, D8, D9 et E1 à E7) :

- de revenir à la **saisie vente par vente** par les chatteurs, comme dans Imperium, pour un suivi au jour le jour sans attendre la capture Reveal, sans changer la paie ;
- que le **feedback de fin de shift** se fasse dès la fin du shift et serve d'abord à savoir ce que le chatteur a vendu, **à quel fan**, pour vérifier ses ventes et calculer sa paie au jour le jour ; qu'il serve aussi à remonter ce qui est utile (demandes des fans, scripts qui manquent, contenu qui manque) ;
- un **garde-fou automatique**, fiable et robuste, qui compare le feedback aux ventes de l'onglet Ventes de Reveal et signale un écart trop important ;
- une fois Reveal lu, que la paie lise directement ses ventes (source « détectée », déjà prévue) ;
- chaque semaine, trois **retours de l'IA** au chatteur au plus, chacun avec l'extrait du message, ce qui n'allait pas et comment il aurait pu mieux faire pour vendre, vus aussi du manager, **sans aucune conséquence sur la paie** ;
- sur téléphone : ses ventes du shift, la somme, son palier et l'objectif collectif ; pas de classement ; pas l'agenda de la créatrice, sauf ce qui est utile à l'équipe.

La lecture d'Imperium du 02/11 (hors dépôt) a montré que ses ventes saisies n'avaient pas de clé d'idempotence, que le serveur ne vérifiait pas que le shift concernait la bonne créatrice, et qu'**aucun contrôle ne comparait les ventes déclarées aux ventes réelles** de la plateforme.

## Décision

### 1. La vente saisie

- Pendant ou après son shift, le chatteur saisit chaque vente (`sale_entry`) : le **fan** (son pseudo sur la plateforme, en texte, relié au fan de Nirvana quand le connecteur le connaît), le **montant brut** payé par le fan (unités mineures, devise du compte, ADR 0011), le **type** (média privé, pourboire, abonnement, autre) et une note facultative. L'heure est celle de la saisie ; elle n'est pas demandée.
- Le serveur rattache la vente à un shift **du membre, sur cette créatrice**, en cours ou fini depuis moins de 24 h, et vérifie les trois ; sinon 409.
- **Idempotence** : chaque saisie porte une clé posée par l'appareil ; un double envoi rend la même vente.
- Annulable pendant 5 secondes. Ensuite, une vente ne s'efface jamais : elle se corrige par une nouvelle saisie qui la remplace, journalisée, tant que le rapport n'est pas validé ; après, par une correction de rapport (EQ-03).
- Créer, corriger ou annuler une vente prend le verrou consultatif (membre, période) de la paie, comme un rapport (ADR 0023, 0035) ; une période verrouillée refuse la saisie.

### 2. Le rapport de fin de shift devient le feedback

- Il est dû dès la fin du shift. Il **reprend les ventes saisies** du shift, que le chatteur complète ou corrige avant l'envoi ; son montant est **la somme de ses ventes**, plus aucun champ de montant libre. Un shift sans vente l'envoie à 0.
- Il garde le commentaire (ce qui s'est passé) et l'incident (EQ-03), et gagne des **remontées** : une catégorie fermée (demande d'un fan, script qui manque, contenu qui manque, autre) et une phrase. Les remontées vont au topo de la semaine de la créatrice (ADR 0042 § 5) ; les noms de fans qu'elles contiennent restent des données, jamais des instructions (règle 4 de `CLAUDE.md`).

### 3. Le compteur au jour le jour

- À chaque saisie, la commission **estimée** du chatteur se recalcule par la fonction pure du moteur de paie, sur ses ventes non annulées de la quinzaine, et s'affiche comme estimée. Le relevé calculé à la validation reste la seule vérité ; rien ne change à PAIE.

### 4. Le contrôle du rapport

Un contrôle (`report_check`), fonction pure du domaine, tourne à l'envoi du rapport et chaque fois que sa référence change. Il ne modifie jamais un montant : il marque.

- **Toujours** : chaque vente sur la bonne créatrice et le bon shift ; même fan et même montant deux fois en moins de 10 minutes signalés comme doublon possible ; un total au-dessus de trois fois la médiane des shifts du membre sur 30 jours signalé.
- **Dès que le connecteur lit les ventes de Reveal** : la somme du rapport est comparée aux ventes de Reveal sur la fenêtre du shift (début, fin plus la marge d'accès de l'ADR 0025), au membre si Reveal dit qui a vendu, sinon au compte ; puis rapprochée vente par vente (fan, montant). Un écart d'au plus **5 % et d'au plus 10 €** (réglages de l'agence) valide le rapport automatiquement, au nom du « contrôle automatique », au journal. Au-delà, le rapport passe en ambre « écart » chez le manager en poste ou le propriétaire, avec les deux sommes et le rapprochement ligne par ligne ; il le valide ou le renvoie.
- **Tant que Reveal n'est pas lu**, il n'y a pas de référence extérieure : la validation reste humaine, comme aujourd'hui, et le contrôle ne fait que mettre ses signaux devant le valideur. Aucun rapport n'est validé par le code sans les ventes de la plateforme en face.

### 5. Quand Reveal est lu

- Le compte passe en source « détectée » à une frontière de période (ADR 0023) ; la paie lit les ventes de Reveal, attribuées au membre en poste (ADR 0023, 0025). La saisie disparaît pour ce compte ; le rapport reste dû pour le commentaire, l'incident, les remontées et le contrôle.

### 6. Les retours de l'IA au chatteur

- Une fois par semaine, **trois points au plus**. Le code choisit les passages (une offre refusée, une vente manquée, un fan qui part, une règle de la méthode enfreinte) parmi les messages que Reveal attribue au chatteur ; le modèle de langage juge chaque passage contre la méthode de l'agence (la rubrique des évaluations) et rend, par un schéma Zod, l'extrait, ce qui n'allait pas et ce qu'il aurait fallu faire pour vendre.
- Visibles du chatteur, du manager et du propriétaire, avec une vue d'équipe des fautes les plus fréquentes ; jamais de la créatrice (ADR 0042 § 2).
- **Aucune conséquence sur la paie** : aucun malus calculé, aucun lien avec les relevés. Un manager peut s'en servir pour former, et poser un malus à la main comme aujourd'hui. Le vocabulaire est « retour », jamais « sanction ».
- Attend la lecture des messages de Reveal et la clé du fournisseur ; coût dans le plafond de dépense IA.

### 7. Ce que montre son téléphone

- **Aujourd'hui**, en tête : son shift, « + Vente », ses ventes du shift et leur somme, sa commission estimée, son palier dans la quinzaine, l'objectif collectif ; puis « Faire mon rapport » à la fin. Le détail reste dans Commissions.
- Pas de classement nominatif : il montrerait ce que gagnent les autres.
- Il ne voit pas l'agenda de la créatrice, sauf les éléments qu'elle ou l'agence marque « utile à l'équipe » (un live, un nouveau contenu, une absence).

## Conséquences

Positives :
- Le chatteur voit ce qu'il gagne au fil du shift ; l'agence voit qui a vendu quoi, à quel fan, sans relire un message libre.
- La validation devient un contrôle chiffré quand Reveal est lu, et l'humain ne regarde plus que les écarts.
- La saisie ne compte jamais deux fois : idempotence, verrou de période, une seule source par compte.

Négatives, à surveiller :
- Saisir chaque vente coûte quelques secondes au chatteur : « + Vente » tient en un écran et trois champs.
- Les seuils de 5 % et 10 € sont un point de départ ; à revoir sur un mois de données réelles.
- Le rapprochement dépend de ce que Reveal dit de l'auteur d'une vente : à vérifier à la capture.

## Alternatives rejetées

- **Garder un montant total libre à côté des ventes** : deux chiffres qui divergent, et rien à rapprocher.
- **Valider automatiquement avant que Reveal soit lu** : sans référence extérieure, ce serait valider la parole du chatteur sans regard humain.
- **Un classement entre chatteurs** : il exposerait la paie des autres, ce que la base interdit (ADR 0023).
- **Des malus calculés par l'IA** : un jugement de langage ne décide jamais d'un montant.
