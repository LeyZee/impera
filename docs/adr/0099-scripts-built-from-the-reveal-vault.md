# 0099. Synchroniser le coffre Reveal et bâtir des scripts avec ses médias, sans rien téléverser

Statut : proposed
Date : 2026-11-12
Précise : l'ADR 0030 (médiathèque, le coffre fait foi), l'ADR 0018 (port étendu, garde d'écriture), l'ADR 0083 (description détaillée, validée avant usage) et la fiche P6-01 (catalogue = index des scripts Reveal). Ne remplace rien.

## Contexte

Le 12/11/2026, Charles demande de synchroniser le CRM avec le coffre de Reveal : récupérer les dossiers, l'emplacement de chaque média et les médias eux-mêmes, leur appliquer une description dans le CRM sans rien ré-uploader, puis bâtir des scripts à partir de ces médias. Le coffre contient déjà beaucoup de scripts prêts ; les refaire à la main serait du temps perdu. Desirely, l'outil concurrent, le fait (synchronisation des médias et des dossiers de la plateforme).

Ce qui est déjà acquis :

- l'ADR 0030 (acceptée le 27/10) fixe la médiathèque comme reflet du coffre : liaisons `media_platform_refs` par plateforme, job `media.sync`, description par le rôle `sense` puis validation humaine, fichier original lu puis effacé, vignette floutée seule gardée ;
- la capture du 10/11 (`docs/reference/reveal-api-observed.md`) a observé `vault.folders` (dossiers, nombre de photos et de vidéos), `vault.medias` (médias par dossier, paginés, avec un champ `description` et une fourchette de prix suggérée), `scripts.list` et `scriptSequences.list` ; `FakeReveal` les simule ;
- ni `listVaultMedia`, ni `fetchMedia`, ni `media_platform_refs`, ni `media.sync` ne sont codés (P2-02, fil Bilan).

Ce qui n'est tranché nulle part : bâtir dans le CRM un script fait de médias **déjà** dans le coffre, et le faire exister dans Reveal. L'ADR 0056 couvre les scripts tournés par la créatrice et téléversés (SC-06) ; l'ADR 0030 rejette le téléversement de médias par Impera. Il manque le cas du milieu : un script écrit chez nous, fait de médias que Reveal a déjà.

## Décision

1. **Trois temps, livrés dans cet ordre, chacun utile seul.**
   1. **Synchroniser le coffre** (ADR 0030 § 2, sans changement) : dossiers et médias, lecture seule.
   2. **Importer les scripts existants** (P6-01) : les séquences et leurs étapes lues dans Reveal, reliées aux liaisons de leurs médias. Un script importé n'est proposable que quand chacun de ses médias a une description validée (ADR 0083).
   3. **Bâtir un script avec les médias du coffre** : l'agence compose dans le CRM une séquence d'étapes (texte, médias vendus, aperçu, prix) en ne choisissant que des médias synchronisés ; le connecteur crée l'étape et la séquence dans Reveal en **référençant les identifiants du coffre**. Aucun fichier ne quitte Impera, aucun média n'est téléversé : l'ADR 0030 tient.

2. **Les dossiers sont lus, jamais réorganisés.** Le dossier d'un média (`folder_ref`, `folder_name`) vient de Reveal à chaque synchronisation ; le moment Jour ou Nuit se lit dans son nom (P6-01). Le CRM ne crée, ne renomme et ne déplace aucun dossier du coffre. Un média déplacé dans Reveal change de dossier chez nous à la synchronisation suivante, sans perdre sa description.

3. **La description de Reveal est un point de départ, jamais une validation.** Le champ `description` d'un média du coffre, quand il est rempli, est repris comme une ligne `media_descriptions` d'auteur `platform`, non validée. La description qui sert à la vente reste celle de l'ADR 0083 (rôle `sense` en détail, ou texte et niveau écrits par l'agence quand la vision ne décrit pas), validée par un humain. La fourchette de prix suggérée par Reveal est affichée à l'agence à côté du prix, jamais appliquée par le code.

4. **La première synchronisation se fait par lots, dans le budget.** La lecture des dossiers et des liaisons est immédiate et ne coûte aucun appel d'IA ; la description par la vision part par lots ordonnés (d'abord les médias des scripts importés, puis le reste du coffre) et s'arrête au plafond du jour du budget IA. L'écran montre « décrits / à décrire » par dossier. Une vidéo se décrit par images clés et transcription (ADR 0030 § 3), extraites du flux que Reveal sert ; si ce flux ne se lit pas, la vidéo attend un texte de l'agence, jamais une description inventée.

5. **Écrire dans Reveal passe par la garde d'écriture.** Créer une étape et une séquence sont deux nouvelles écritures du port (`createScriptStep`, `createScriptSequence`, drapeau `scriptWrite`), avec clé d'idempotence, derrière `run(…, writes: true)` (ADR 0018 § 3). Tant que Charles n'a pas ouvert l'écriture du compte, le script reste un brouillon du CRM. Un script créé par Impera est relu par la synchronisation suivante comme n'importe quel script Reveal : la plateforme fait foi, nous ne gardons pas de copie qui divergerait. On ne modifie ni ne supprime jamais un script dans Reveal depuis le CRM : on en crée un nouveau.

6. **Qui livre quoi.** La lecture du coffre et des scripts est celle de P2-02 (`listVaultMedia`, `listScripts`, fil Bilan), réutilisée telle quelle. Le téléchargement des octets (`fetchMedia`) fait l'objet d'une fiche à part, après la première lecture réelle des liens de médias. Le job de synchronisation, ses tables et l'écran sont des fiches de cette ADR ; la création de scripts dans Reveal s'ajoute aux écritures de P2-03.

7. **Données réelles.** Aucun média, nom de dossier, lien ou description réels dans le dépôt, les tests ou les docs ; `FakeReveal` porte un coffre fictif (dossiers, photos et vidéos générées, dont une vidéo en flux découpé). La vérification sur le vrai compte se fait sur le PC de Charles, en lecture seule pour les temps 1 et 2.

## Conséquences

Positives :

- Les scripts existants deviennent vendables par l'agent sans être refaits : il suffit de décrire leurs médias.
- Un nouveau script se compose là où vivent les descriptions, sans téléchargement ni ré-upload.
- Les temps 1 et 2 sont des lectures : aucun risque pour le compte Reveal.

Négatives :

- La description d'un gros coffre prend plusieurs jours au plafond de 20 € par jour.
- Le temps 3 demande deux écritures dont la forme (`POST /scripts`, `POST /script-sequences`, `PUT /script-sequences/:id/steps`) a été vue mais pas lue en détail : une capture ciblée est nécessaire avant son code.
- Une redescription demande une session Reveal valide (jeton de 24 h, P2-01).

À surveiller :

- La durée de validité des liens de médias et la lecture du flux vidéo (`reveal-api-observed.md`, « Ce qui reste ouvert », point 7) : fixées par la première lecture réelle.
- Le partage d'un dossier entre créatrices (`isSharedForSfs`) : lu, jamais modifié.

## Alternatives rejetées

- **Copier les originaux dans le CRM.** Un stock de contenus intimes à protéger pour un gain faible, la plateforme les garde (ADR 0030 § 4, choix de Charles du 27/10).
- **Télécharger le coffre par l'extension pendant que Charles le parcourt.** Dépend d'un geste humain et d'un navigateur ouvert ; le connecteur serveur lit les mêmes routes avec la session capturée.
- **Bâtir les scripts dans Reveal seulement.** Les descriptions sont dans le CRM : composer ailleurs oblige à des allers-retours entre deux écrans pour chaque étape.
- **Synchroniser dans les deux sens (dossiers, descriptions vers Reveal).** Deux sources de vérité du coffre ; et la description de l'agence est une méthode interne qui n'a rien à faire chez Reveal.
