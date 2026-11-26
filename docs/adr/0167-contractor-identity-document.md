# 0167. La pièce d'identité du prestataire : déposée par lui, lue sur notre serveur, elle conditionne le premier versement

Statut : proposed (Charles, 21/11/2026 : « go » pour la pièce dans le dossier ; « Lecture sur notre serveur » et « Oui, marquée automatique » sur ses cartes ; avis de Sécurité du 21/11 intégré, puis ses neuf précisions du 21/11 au soir)
Date : 2026-11-21

## Contexte

Le dossier de prestataire (EQ-06, lot 5c) garde le nom légal, l'adresse et le numéro fiscal, ainsi que les pièces d'un régime (attestation de résidence fiscale, attestation URSSAF), chiffrées et vérifiées par le propriétaire. Il ne contient aucune pièce d'identité. En cas de litige, de contrôle ou de versement contesté, l'agence ne peut pas prouver qui elle a payé. Charles veut la pièce, et il ne veut pas la vérifier à la main pour chaque chatteur.

Trois façons de vérifier lui ont été présentées : une lecture sur notre serveur, un modèle de vision externe, ou un service KYC spécialisé. Il a choisi la lecture sur notre serveur. La pièce ne sort jamais de chez nous. Cette lecture vérifie la cohérence de la pièce, pas son authenticité.

## Décision

1. **La pièce.** Elle s'ajoute aux pièces du dossier sous le type `identity` : carte d'identité, passeport ou permis de conduire, en cours de validité. Seul le prestataire la dépose, depuis Moi › Dossier. Il saisit aussi sa date de naissance, et le dossier garde son nom légal (déjà présent). Avant le dépôt, un texte court lui dit à quoi elle sert, qui la voit et combien de temps on la garde.
2. **Le premier versement l'attend.** Un relevé ne peut pas être marqué payé tant que le prestataire n'a pas de pièce d'identité acceptée (raisons `identity_missing` et `identity_unverified`). C'est le même mécanisme que l'attestation de résidence (ADR 0041 § 4) : l'état « Versement bloqué » apparaît sur le relevé avant le virement. Le serveur le tient dans « Marquer payé », et un test le prouve. Les factures, elles, partent quand même.
3. **La lecture au dépôt.** Elle n'accepte que des images (JPEG ou PNG), dont le type est vérifié par les octets. Un PDF est refusé pour cette pièce. Le fichier est décodé, redimensionné dans des bornes et réencodé par un processus à part, sans réseau, avec des bornes d'octets, de pixels, de temps et de mémoire. Les métadonnées sont retirées à cette étape. La bande lisible par machine (MRZ) est ensuite lue par une bibliothèque d'OCR embarquée, sans aucun appel sortant. La lecture vérifie :
   - les sommes de contrôle de la bande ;
   - que le nom et le prénom lus correspondent au nom légal du dossier et au nom de « Où te verser » (ADR 0165), sans tenir compte des accents ni de la casse ;
   - que la pièce n'est pas expirée ;
   - que le titulaire est majeur, et que la date de naissance saisie est celle de la bande.

   **Comment le processus est sans réseau.** Le lecteur tourne dans un conteneur à part, `id-reader`, rattaché à aucun réseau (`network_mode: none`). Il ne partage avec le worker qu'un volume en mémoire, avec un dossier d'entrée et un dossier de sortie. Au démarrage, il tente une connexion sortante et refuse de démarrer si elle aboutit. La bibliothèque d'OCR et ses données de langue sont dans l'image du conteneur. Rien n'est téléchargé à l'exécution. La dépendance passe une quarantaine de 14 jours, comme les autres.

   **Jamais d'acceptation par défaut.** La sortie du lecteur est un objet typé, validé par Zod : verdict, codes de motif, booléens, sans aucun texte libre. Un plantage, un délai dépassé ou une sortie mal formée donnent `unreadable`, donc l'ambre, jamais une acceptation.

   **Combien à la fois.** Une seule lecture à la fois par membre, sous un plafond global de lectures simultanées. Le compteur de dépôts (§ 7) s'incrémente avant le décodage.
4. **L'acceptation automatique.** Une pièce dont tout concorde est acceptée sans humain. Elle est marquée « acceptée automatiquement », à l'écran comme au journal, de façon distincte d'une acceptation par le propriétaire. Son signataire est le système, sous une valeur distincte qu'aucune route ne peut poser. Le propriétaire peut la révoquer avec un motif, comme un refus. La révocation et l'acceptation manuelle appartiennent au propriétaire seul, après une connexion récente : la politique le tient, et un test le prouve. L'acceptation automatique vaut pour les noms du moment. Si le nom légal ou le nom de « Où te verser » change ensuite, la pièce retombe en ambre et le versement se rebloque. Le cas suivant reste en ambre pour le propriétaire, qui accepte ou refuse lui-même : une pièce sans bande lisible (permis, ancienne carte), où la majorité ne repose que sur la date saisie ; une lecture incertaine ; un nom qui ne concorde pas ; une date de naissance saisie différente de la bande ; une pièce expirée. **Un titulaire mineur n'est jamais accepté.** La pièce est refusée, et le propriétaire ne peut pas accepter à la main une pièce marquée `minor`. La paie du membre est bloquée et le propriétaire est alerté en rouge. L'alerte ne porte ni date ni nom lu.
5. **Ce qu'on garde de la lecture.** On garde le verdict et ses codes de motif (`mrz_missing`, `mrz_checksum`, `name_mismatch`, `expired`, `minor`, `unreadable`), rien d'autre. Ni le texte de la bande, ni le numéro de la pièce, ni aucun champ lu n'est écrit en base, dans un journal ou dans une erreur. Quand la majorité est vérifiée par la bande, on garde « majeur vérifié le … » ; la date de naissance saisie reste dans le profil scellé du dossier. On garde l'image réencodée, scellée comme les autres pièces sous un contexte propre. L'original déposé est jeté après la lecture.
6. **Qui la voit.** Le propriétaire seul l'ouvre, après une connexion récente avec mot de passe et code, et chaque ouverture est écrite au journal, sans valeur. Le manager ne la voit jamais. Le prestataire voit qu'il l'a déposée et son état, jamais l'image servie à nouveau. Le fichier est rendu en téléchargement (`Content-Disposition: attachment`, `nosniff`), jamais affiché dans son type d'origine. Il n'existe ni vignette ni cache.
7. **Combien de dépôts.** Au plus trois dépôts par jour et par membre. Un dépôt refusé par la lecture compte.
8. **Combien de temps.** La pièce est gardée pendant la collaboration, puis **cinq ans après la fin de l'espace de départ** (ADR 0166 § 5) : c'est le délai de prescription d'un litige sur le contrat (Charles, 21/11, à confirmer par son comptable). Elle est ensuite réellement effacée des deux buckets, et le verrou de conservation des pièces (ADR 0041 § 6) ne la prolonge jamais au-delà. Une pièce refusée ou remplacée est effacée à la fin de son verrou de dépôt.
9. **Jamais à une IA.** Aucune pièce d'identité n'est envoyée à un modèle ni à un tiers. Changer cela demande une autre ADR et le mot de Charles.

10. **Tests.** Les fixtures ne contiennent que des bandes fabriquées par le test. Jamais une vraie pièce, jamais un spécimen copié.

## Conséquences

- Positives : l'agence sait qui elle paie. Charles ne regarde plus que les pièces en ambre. La donnée ne sort pas de nos machines.
- Négatives : une bande forgée avec soin passe la lecture. L'acceptation automatique prouve la cohérence de la pièce, pas son authenticité, et la mention « acceptée automatiquement » le rappelle. Un permis ou une vieille carte demande toujours un regard humain. Une dépendance d'OCR s'ajoute, avec sa quarantaine.
- À surveiller : la part des pièces qui finissent en ambre. Si elle reste haute, la question d'un service spécialisé reviendra à Charles.

## Alternatives rejetées

- **Un modèle de vision externe** : il lit toutes les pièces pour moins d'un centime, mais la pièce part chez un tiers. Charles a refusé.
- **Un service KYC spécialisé** : il détecte les faux et compare la pièce à un selfie, pour 1 à 2 € par chatteur, mais la pièce part chez le prestataire. Charles a refusé pour l'instant.
- **Une vérification toujours manuelle** : c'est le geste que Charles veut éviter.
