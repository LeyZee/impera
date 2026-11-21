# 0167. La pièce d'identité du prestataire : déposée par lui, lue sur notre serveur, elle conditionne le premier versement

Statut : proposed (Charles, 21/11/2026 : « go » pour la pièce dans le dossier ; « Lecture sur notre serveur » et « Oui, marquée automatique » sur ses cartes ; avis de Sécurité du 21/11 intégré)
Date : 2026-11-21

## Contexte

Le dossier de prestataire (EQ-06, lot 5c) garde le nom légal, l'adresse et le numéro fiscal, ainsi que les pièces d'un régime (attestation de résidence fiscale, attestation URSSAF), chiffrées et vérifiées par le propriétaire. Il ne contient aucune pièce d'identité. En cas de litige, de contrôle ou de versement contesté, l'agence ne peut pas prouver qui elle a payé. Charles veut la pièce, et il ne veut pas la vérifier à la main pour chaque chatteur.

Trois façons de vérifier lui ont été présentées : une lecture sur notre serveur, un modèle de vision externe, ou un service KYC spécialisé. Il a choisi la lecture sur notre serveur. La pièce ne sort jamais de chez nous. Cette lecture vérifie la cohérence de la pièce, pas son authenticité.

## Décision

1. **La pièce.** Elle s'ajoute aux pièces du dossier sous le type `identity` : carte d'identité, passeport ou permis de conduire, en cours de validité. Seul le prestataire la dépose, depuis Moi › Dossier. Il saisit aussi sa date de naissance, et le dossier garde son nom légal (déjà présent). Avant le dépôt, un texte court lui dit à quoi elle sert, qui la voit et combien de temps on la garde.
2. **Le premier versement l'attend.** Un relevé ne peut pas être marqué payé tant que le prestataire n'a pas de pièce d'identité acceptée (raisons `identity_missing` et `identity_unverified`). C'est le même mécanisme que l'attestation de résidence (ADR 0041 § 4) : l'état « Versement bloqué » apparaît sur le relevé avant le virement. Les factures, elles, partent quand même.
3. **La lecture au dépôt.** Elle n'accepte que des images (JPEG ou PNG), dont le type est vérifié par les octets. Un PDF est refusé pour cette pièce. Le fichier est décodé, redimensionné dans des bornes et réencodé par un processus à part, sans réseau, avec des bornes d'octets, de pixels, de temps et de mémoire. Les métadonnées sont retirées à cette étape. La bande lisible par machine (MRZ) est ensuite lue par une bibliothèque d'OCR embarquée, données de langue comprises, sans aucun appel sortant. La lecture vérifie :
   - les sommes de contrôle de la bande ;
   - que le nom et le prénom lus correspondent au nom légal du dossier et au nom de « Où te verser » (ADR 0165), sans tenir compte des accents ni de la casse ;
   - que la pièce n'est pas expirée ;
   - que le titulaire est majeur.
4. **L'acceptation automatique.** Une pièce dont tout concorde est acceptée sans humain. Elle est marquée « acceptée automatiquement », à l'écran comme au journal, de façon distincte d'une acceptation par le propriétaire. Le propriétaire peut la révoquer, avec un motif, comme un refus. Le cas suivant reste en ambre pour le propriétaire, qui accepte ou refuse lui-même : une pièce sans bande lisible (permis, ancienne carte), une lecture incertaine, un nom qui ne concorde pas ou une pièce expirée. **Un titulaire mineur n'est jamais accepté.** La pièce est refusée, la paie du membre est bloquée et le propriétaire est alerté en rouge.
5. **Ce qu'on garde de la lecture.** On garde le verdict et ses codes de motif (`mrz_missing`, `mrz_checksum`, `name_mismatch`, `expired`, `minor`, `unreadable`), rien d'autre. Ni le texte de la bande, ni le numéro de la pièce, ni aucun champ lu n'est écrit en base, dans un journal ou dans une erreur. Quand la majorité est vérifiée par la bande, on garde « majeur vérifié le … » ; la date de naissance saisie reste dans le profil scellé du dossier.
6. **Qui la voit.** Le propriétaire seul l'ouvre, après une connexion récente avec mot de passe et code, et chaque ouverture est écrite au journal, sans valeur. Le manager ne la voit jamais. Le prestataire voit qu'il l'a déposée et son état, jamais l'image servie à nouveau. Le fichier est rendu en téléchargement (`Content-Disposition: attachment`, `nosniff`), jamais affiché dans son type d'origine. Il n'existe ni vignette ni cache.
7. **Combien de dépôts.** Au plus trois dépôts par jour et par membre. Un dépôt refusé par la lecture compte.
8. **Combien de temps.** La pièce est gardée pendant la collaboration, puis **cinq ans après la fin de l'espace de départ** (ADR 0166 § 5) : c'est le délai de prescription d'un litige sur le contrat (Charles, 21/11, à confirmer par son comptable). Elle est ensuite réellement effacée des deux buckets, et le verrou de conservation des pièces (ADR 0041 § 6) ne la prolonge jamais au-delà. Une pièce refusée ou remplacée est effacée à la fin de son verrou de dépôt.
9. **Jamais à une IA.** Aucune pièce d'identité n'est envoyée à un modèle ni à un tiers. Changer cela demande une autre ADR et le mot de Charles.

## Conséquences

- Positives : l'agence sait qui elle paie. Charles ne regarde plus que les pièces en ambre. La donnée ne sort pas de nos machines.
- Négatives : une bande forgée avec soin passe la lecture. L'acceptation automatique prouve la cohérence de la pièce, pas son authenticité, et la mention « acceptée automatiquement » le rappelle. Un permis ou une vieille carte demande toujours un regard humain. Une dépendance d'OCR s'ajoute, avec sa quarantaine.
- À surveiller : la part des pièces qui finissent en ambre. Si elle reste haute, la question d'un service spécialisé reviendra à Charles.

## Alternatives rejetées

- **Un modèle de vision externe** : il lit toutes les pièces pour moins d'un centime, mais la pièce part chez un tiers. Charles a refusé.
- **Un service KYC spécialisé** : il détecte les faux et compare la pièce à un selfie, pour 1 à 2 € par chatteur, mais la pièce part chez le prestataire. Charles a refusé pour l'instant.
- **Une vérification toujours manuelle** : c'est le geste que Charles veut éviter.
