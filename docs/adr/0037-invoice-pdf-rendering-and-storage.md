# 0037. Factures : un PDF/A rendu une fois par PDFKit, gardé dix ans sous verrou de conformité, en deux copies

Statut : accepted (Charles, 01/11/2026 11h34, « Ok0037 », sur le texte repris après les deux relectures de Bilan, dont la phrase amendée sur les deux copies et le mode conformité, lue par Charles)
Date : 2026-10-31
Précise : l'ADR 0023 (§ Factures, « son PDF est rendu une fois depuis ces données, gardé avec son empreinte, et plus jamais régénéré » ; « deux dépendances nouvelles se décident dans leurs fiches : la génération de PDF… ») et l'ADR 0028 (§ 4, le bucket des factures gardé dix ans, avec son propre verrou et ses propres identifiants, dont elle ne fixe ni le mode ni le lieu des clés)

## Contexte

Depuis #328, la validation d'un relevé émet sa facture et ses avoirs en base : numéro, lignes, mentions et parties sont figés. Il manque le document lui-même, celui que le chatteur reçoit, que le comptable range et qu'un contrôle fiscal demande (EQ-06, lot 4). La fiche fixe quatre exigences :

- **rendu une fois** par un job, depuis les données figées, jamais régénéré ;
- **servi tel quel**, identique octet pour octet à chaque téléchargement, même après un changement des réglages de l'agence ou du dossier du prestataire ;
- **gardé dix ans** (art. L123-22 du Code de commerce), hors du disque du serveur ;
- chaque mention du régime **présente sur le PDF**, vérifiée par un test.

La base est prête : `invoice_pdfs` (migration 0041) garde par facture une clé de stockage et l'empreinte SHA-256, écrites une fois par le job. Restent deux choix : avec quoi rendre le PDF, et où garder ses octets.

Deux faits pèsent sur ces choix :

- **la facturation électronique**. Selon le calendrier en vigueur, une petite entreprise française devra émettre ses factures entre entreprises établies en France sous forme électronique à partir du 1er septembre 2027, par une plateforme agréée. Un chatteur établi en France, autofacturé par l'agence, entre dans ce cas ; un chatteur du Bénin ou de Madagascar relève de l'e-reporting. Un des formats admis, Factur-X, est un PDF/A-3 qui porte en pièce jointe les données de la facture en XML. Ce lot n'envoie rien à une plateforme (fiche EQ-06), mais le format choisi aujourd'hui ne doit pas fermer cette porte ;
- **les octets ne se recalculent pas**. Une facture se corrige par avoir, jamais en refaisant son PDF. Si un PDF est perdu, aucun rendu ultérieur n'est la même pièce : la police, la bibliothèque et la mise en page auront pu changer. Une seule copie, chez un seul fournisseur, ne suffit donc pas.

## Décision

**1. Le PDF est un PDF/A-3b rendu par PDFKit, dans le worker.** PDFKit (licence MIT, JavaScript pur, aucune dépendance native ; la version est fixée dans `package.json` par le lot 4) écrit du PDF/A-3, balisé, avec la langue du document et des pièces jointes déclarées comme la norme le demande. C'est exactement l'enveloppe de Factur-X : le jour où la plateforme agréée est choisie, on ajoute le XML au même PDF, sans changer de bibliothèque ni de format d'archive. Le XML n'est pas produit dans ce lot.

Essai fait avant d'écrire cette ADR (hors dépôt, supprimé ensuite) : un PDF/A-3b avec une police embarquée et une pièce jointe XML, rendu deux fois, dans deux processus, donne les mêmes octets, à condition de fixer la date de création. Elle vaudra `issued_at` de la facture.

**2. Le rendu est reproductible et vérifié.** La date de création du PDF est celle de l'émission. Aucune valeur aléatoire n'est écrite, et la police est embarquée depuis le dépôt. Un job relancé après une panne produit donc les mêmes octets. Le lot vérifie trois choses :

- deux rendus des mêmes données sont identiques ;
- chaque mention du régime se lit dans le texte extrait du PDF (bibliothèque d'extraction en dépendance de test seulement) ;
- la police couvre chaque caractère imprimé, espaces fines insécables des montants comprises ; sinon la facture n'est pas rendue et l'erreur est dite.

La conformité PDF/A-3 est contrôlée avec veraPDF, le validateur de référence, sur un PDF produit avec des données inventées.

**3. Une seule police, Geist**, celle du design system, sous licence SIL Open Font License, qui permet de l'embarquer. Ses fichiers et sa licence entrent dans le dépôt, à côté du code qui rend la facture. Si le test de couverture montre qu'il manque à Geist un caractère imprimé, le lot le dit et propose une autre police libre avant d'écrire le rendu. La mise en page est sobre : en-tête des parties, tableau des lignes, totaux, mentions, puis le relevé de commissions en annexe dans le même fichier.

**4. Les octets vont dans le bucket des factures de l'ADR 0028, jamais dans Postgres ni sur le disque.** C'est un bucket Hetzner (Europe, compatible S3), séparé du bucket des sauvegardes de 30 jours, créé avec le versioning et le verrou d'objets (Hetzner ne les ajoute pas à un bucket existant) :

- **clé** : `invoices/<année d'émission>/<id de la facture>.pdf`. Ni nom ni numéro de prestataire dans la clé ;
- **verrou en mode conformité** (compliance), et non en mode gouvernance comme les sauvegardes de l'ADR 0028. En mode gouvernance, un compte qui a le droit de passer outre, comme le propriétaire du projet Hetzner, peut effacer une version verrouillée. En mode conformité, personne ne peut effacer une version ni raccourcir son verrou avant la date : ni l'application, ni le propriétaire du projet. Rien n'a jamais à être effacé avant la fin, puisqu'un objet n'est jamais remplacé (point 5) et qu'une facture fausse se corrige par avoir. Une erreur coûte quelques kilo-octets gardés jusqu'au bout ;
- **fin du verrou, par objet** : dix ans après la clôture de l'exercice de la facture (par exemple, une facture de 2027 est verrouillée jusqu'au 31 décembre 2037 si l'exercice est l'année civile). Un verrou fixe de dix ans à partir de l'envoi laisserait sans protection les derniers mois de l'obligation. La date posée est gardée dans `invoice_pdfs` (`retain_until`) : un contrôle relit ce qui a été posé, et un changement de la date de clôture ne touche que les PDF suivants. Le bucket a aussi un verrou par défaut (conformité, dix ans), filet pour un objet qui arriverait sans date ;
- **un projet Hetzner pour lui seul** : chez Hetzner, une clé S3 vaut pour tous les buckets de son projet. Le bucket des factures vit donc dans un projet séparé de celui des sauvegardes, avec une seule clé, celle de l'application (API et worker). La clé du service `backup` ne voit pas les factures, et celle de l'application ne voit pas les sauvegardes. Il n'y a pas de politique par préfixe, dont une erreur de saisie suffirait à annuler l'effet : le mode conformité protège chaque version verrouillée, même contre une clé qui a tous les droits du projet ;
- **envoi signé** avec la somme de contrôle SHA-256 (comme l'ADR 0029) : le bucket refuse un fichier abîmé en route ;
- **exports annuels** d'EQ-17 (factures, avoirs, journal des achats, DAS2) : dans le même bucket, sous `archives/`, écrits par le worker avec la clé de l'application et sous le même verrou ; l'export relit les empreintes de `invoice_pdfs`.

**5. Le job écrit dans cet ordre, et ne remplace jamais rien.** `payroll.render_invoice_pdf` est mis en file dans la transaction qui émet le document, un par document (clé d'idempotence par facture) : une facture émise a toujours son job. Il lit les données figées, rend le PDF, l'envoie avec sa date de fin de verrou, puis écrit la ligne `invoice_pdfs` (clé, empreinte, `retain_until`). S'il est relancé :

- si la ligne existe, il n'y a rien à faire ;
- si l'objet existe sans la ligne (panne entre les deux), il relit l'objet : même empreinte, il écrit la ligne avec la date de verrou lue sur l'objet ; empreinte différente, il n'écrit rien et alerte le propriétaire (`invoice_pdf_conflict`). L'objet n'est jamais remplacé.

Une facture sans PDF reste une facture valide en base, et l'écran dit « PDF en préparation ». Le job réessaie pendant une heure environ. L'alerte `invoice_pdf_missing` part de son dernier essai manqué, jamais pendant une reprise normale.

**6. Une seconde copie, chez un second fournisseur.** Sans elle, le VPS, les sauvegardes et les factures seraient tous chez Hetzner, et aucun verrou ne survit à la fermeture d'un compte (compte compromis, facture impayée, décision du fournisseur). Une fois la ligne `invoice_pdfs` écrite, un second job, `payroll.mirror_invoice_pdf`, copie les mêmes octets dans un bucket OVHcloud Object Storage (France), créé lui aussi avec versioning et verrou, sous la même clé, en mode conformité et avec la même date de fin. Il relit l'objet chez Hetzner, vérifie son empreinte contre la base, l'envoie signé, puis écrit la ligne de la copie dans `invoice_pdf_copies`. Comme `invoice_pdfs` (migration 0041), cette table est en ajout seul : une ligne par copie (facture, fournisseur, clé, empreinte, `retain_until`), clé primaire (facture, fournisseur), écrite une fois et protégée par le même déclencheur que les autres pièces. Rien n'est donc écrit après coup dans la ligne du PDF, et une troisième copie, un jour, ne demandera pas de migration. La reprise suit la règle du point 5 : si l'objet est déjà présent avec la même empreinte, la ligne de la copie est écrite ; une empreinte différente alerte (`invoice_pdf_conflict`) ; rien n'est remplacé. Comme au point 5, l'alerte `invoice_pdf_missing`, qui dit alors que c'est la copie qui manque, ne part que du dernier essai manqué du job, après une heure environ. Les exports annuels sont copiés de la même façon.

OVHcloud est retenu parce qu'il documente le verrou en mode conformité, qu'il ne partage rien avec Hetzner ni avec Neon (AWS), et que ses centres de données sont en France. L'export comptable de chaque période (lot 7) que le propriétaire remet au comptable fera une troisième copie, mais la conservation n'en dépend pas : elle ne repose sur aucun geste humain.

**7. Le téléchargement passe par l'API, qui vérifie l'empreinte.** `GET /v1/payroll/invoices/:id/pdf` lit la ligne `invoice_pdfs` sous la politique de la facture : un membre lit les siennes, le propriétaire et un manager actif toutes. L'API télécharge l'objet chez Hetzner, recalcule son SHA-256 et ne le sert que s'il est égal à celui de la base. Si l'empreinte diffère, elle lit la copie d'OVHcloud avec la même vérification et alerte le propriétaire ; si Hetzner ne répond pas, elle lit la copie sans alerter, une panne passagère n'étant pas une pièce abîmée. Un fichier altéré n'est jamais servi. Les buckets restent privés, sans lien signé public. Le nom du fichier téléchargé est le numéro de la facture.

**8. Les identifiants des deux buckets sont des secrets de déploiement**, comme ceux de l'ADR 0028 : posés dans Coolify par la session de mise en service (runbook `deploy.md`), jamais dans le dépôt, jamais tapés par Charles. En développement et dans les tests, un stockage en mémoire remplace les buckets. La CI vérifie l'envoi signé et le verrou contre un MinIO lancé pour le test : en mode conformité, l'effacement d'une version et le raccourcissement de son verrou sont refusés.

## Questions au comptable

À confirmer avant la mise en service (EQ-17) :

- la date de clôture de l'exercice de l'agence, qui fixe la fin du verrou de chaque PDF (année civile par défaut) ;
- que le PDF/A, sans XML, suffit jusqu'au passage à la facturation électronique, et le calendrier qui s'applique à l'agence pour ses prestataires établis en France.

## Conséquences

Positives :

- un PDF par facture, identique à chaque téléchargement, que personne ne peut effacer ni remplacer pendant toute l'obligation de conservation, ni l'application ni le propriétaire des comptes ;
- deux copies chez deux fournisseurs qui ne partagent rien : la perte d'un compte n'emporte pas les pièces, et un téléchargement passe même quand Hetzner ne répond pas ;
- une pièce prête pour Factur-X : le passage à la facturation électronique ajoute une pièce jointe, il ne refait pas les archives ;
- un worker léger : aucune dépendance native, aucun navigateur dans l'image, environ 25 Mo de bibliothèques ;
- la base reste petite : le dump quotidien ne grossit pas des PDF, et les factures tiennent leurs dix ans hors de Neon.

Négatives :

- un PDF existe en trois temps (l'objet, la ligne, la copie) : les deux jobs gèrent la reprise, et l'alerte dit un PDF ou une copie qui manque ;
- le mode conformité ne pardonne pas : un objet envoyé par erreur reste jusqu'à la fin de son verrou, sans recours possible. En production, seuls les jobs écrivent sous `invoices/` et `archives/` ; la CI écrit dans un MinIO jetable, et l'essai du runbook pose un verrou d'un jour sur un objet de quelques octets ;
- un second fournisseur : un compte OVHcloud que Charles ouvre avant la mise en service (aucune commande à taper), un projet Hetzner de plus, deux jeux d'identifiants dans Coolify, et un abonnement de stockage de plus chez chacun, au prix à vérifier à la mise en service (moins d'un Go en dix ans) ;
- la mise en page s'écrit en code (coordonnées, tableau), sans HTML ni CSS ; elle est sobre et change rarement, et chaque changement ne touche que les factures émises après lui ;
- une dépendance de plus dans le worker (PDFKit) et une de test (extraction de texte) ;
- deux buckets à surveiller : l'état de mise en service d'EQ-17 dira s'ils sont joignables et si des PDF ou des copies manquent.

À faire, dans la PR du lot 4 (après acceptation) :

- `payroll.render_invoice_pdf` et son rendu ; la police Geist et sa licence dans le dépôt ;
- `payroll.mirror_invoice_pdf` ;
- une nouvelle migration : `retain_until` dans `invoice_pdfs`, et la table en ajout seul `invoice_pdf_copies` ;
- le stockage des deux buckets (envoi signé, verrou par objet en mode conformité) et son remplaçant en mémoire ;
- `GET /v1/payroll/invoices/:id/pdf`, avec la lecture de la copie ;
- les événements `invoice_pdf_conflict` et `invoice_pdf_missing` ;
- les tests (reproductibilité, mentions par régime, couverture de la police, date de fin du verrou, reprise après panne des deux jobs, empreinte refusée, lecture de la copie) et le contrôle veraPDF ;
- les variables des deux buckets dans `.env.example` sans valeur ;
- le runbook de déploiement : création des deux buckets avec versioning, verrou et verrou par défaut, projet Hetzner séparé ; puis, avec un objet d'essai verrouillé un jour, la vérification que la clé de l'application ne lit ni ne liste le bucket des sauvegardes, que la clé `backup` ne voit pas les factures, et qu'aucune clé n'efface une version verrouillée ni ne raccourcit son verrou.

## Alternatives rejetées

- **Un navigateur sans tête (Chromium par Playwright) qui imprime du HTML** : mise en page en HTML et CSS, mais une image de plusieurs centaines de Mo pour le worker, un navigateur à tenir à jour sur le serveur, des octets qui changent d'une version à l'autre, et pas de PDF/A.
- **@react-pdf/renderer** : des composants React, mais construit sur PDFKit avec une couche de mise en page en plus, et lié à la version de React du dashboard. Pour une page de facture, la couche ne paie pas son poids.
- **Typst** : la plus belle typographie, mais un binaire ou un module WebAssembly de plus dans l'image, et un second langage de gabarit à maintenir.
- **pdf-lib** : aucune mise en page du texte (ni retour à la ligne, ni tableau), tout serait à écrire.
- **Les octets dans Postgres (`bytea`)** : la ligne et le fichier dans la même transaction, c'est son vrai avantage. Mais rien n'y empêche le rôle admin d'effacer un PDF, la perte du compte Neon emporterait les pièces (le dump de 30 jours ne couvre pas dix ans), et chaque export quotidien porterait tous les PDF.
- **Le disque du serveur** : exclu par la fiche et par l'ADR 0023 ; un VPS reconstruit perd tout.
- **Rendre le PDF à chaque téléchargement** : aucune garantie octet pour octet après un changement de police, de bibliothèque ou de mise en page ; une facture n'est pas une vue.
- **Un lien signé vers le bucket** : l'API ne pourrait plus vérifier l'empreinte avant de servir, et le lien circule hors de la politique de la facture.
- **Le mode gouvernance** (celui des sauvegardes) : le propriétaire du projet, ou une clé qui en reçoit le droit, peut effacer une version verrouillée ; la promesse de conservation dépendrait de la garde d'un compte.
- **Une politique de bucket par préfixe**, dans le projet des sauvegardes : Hetzner documente des politiques par bucket, pas par préfixe, et une politique mal posée ouvre tout sans bruit. Un projet séparé isole par construction.
- **La seconde copie confiée au comptable seul** (l'export de chaque période) : elle dépend d'un geste répété et de l'outil du comptable, et laisse jusqu'à une période sans seconde copie.
- **Une seule copie chez Hetzner, la perte du compte dite comme un risque accepté** : une pièce perdue ne se refait pas (Contexte), et le VPS, les sauvegardes et les factures seraient chez le même fournisseur, ce que l'ADR 0028 voulait éviter.
