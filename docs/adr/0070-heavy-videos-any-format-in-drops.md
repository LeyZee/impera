# 0070. Une vidéo déposée pèse jusqu'à 10 Go et vient dans tout format courant ; ce que les plateformes ne lisent pas est converti en MP4

Statut : accepted (Charles, 05/11/2026, 18 h 44, « ok 0070 » ; choix de Charles du 05/11/2026, 18 h 44 : « 10 Go, tout format, converti », sur sa demande de 18 h 39 : « il faut faire en sorte que le dépôt des médias prenne en compte beaucoup de gigas […] différents types de formats vidéo […] globalement sur un format iPhone […] on ne sait jamais, il peut y avoir d'autres formats »)
Date : 2026-11-05
Précise : l'ADR 0055 § 2 (poids maximal et types admis d'une catégorie) et § 3 (le nettoyage). Ne remplace rien d'autre.

## Contexte

Le téléphone envoie déjà chaque fichier directement au bucket des médias, par morceaux de 8 Mio, avec reprise après coupure (CR-06 b1). Les octets ne passent jamais par l'API, donc rien de ce côté ne limite la taille. Trois choses la limitent aujourd'hui :

- **Le poids** : une vidéo fait au plus 500 Mo (`DROP_MAX_BYTES` et la contrainte `content_drop_files_bytes_check` de 0108). Une minute de 4K à 60 i/s en HEVC sur iPhone pèse environ 400 Mo, et une minute de ProRes sur un iPhone Pro environ 6 Go.
- **Les formats** : seuls `video/mp4` et `video/quicktime` sont admis, et le nettoyage (`ffmpeg -c copy`) ne lit que ces conteneurs.
- **Le worker** : il prévoit 10 minutes pour télécharger un fichier, et rien ne vérifie la place disque avant de travailler sur plusieurs Go.

## Décision

### 1. Le poids

- Une vidéo pèse au plus **10 Gio**. Les photos et les vocaux restent à 30 Mo. La contrainte de base suit dans une nouvelle migration : on n'écrit jamais dans une migration déjà appliquée.
- Les morceaux restent à 8 Mio. Une vidéo de 10 Gio part en 1 280 morceaux, loin de la limite S3 de 10 000, et une coupure en 4G ne coûte jamais plus de 8 Mio. Le téléphone envoie jusqu'à **4 morceaux à la fois** (lot d).

### 2. Les formats admis

- Le téléphone déclare le type, et le serveur le vérifie sur les premiers octets du fichier, jamais sur son nom (`domain/sniff.ts`). Trois familles sont admises :
  - ISO-BMFF : MOV, MP4, M4V, 3GP ;
  - EBML : MKV, WebM ;
  - RIFF : AVI.
- Un navigateur qui ne donne pas de type (cas fréquent pour MKV) laisse l'écran le déduire de l'extension. Le serveur vérifie ensuite les octets, comme pour tout fichier.

### 3. Ce qui en sort : recopié quand c'est possible, converti sinon

- **Recopié sans perte** (`-c copy`, comme aujourd'hui) quand la vidéo est en H.264 ou en HEVC dans un conteneur ISO-BMFF. C'est le cas de toute vidéo d'iPhone par défaut, HDR et Dolby Vision compris. La sortie garde son conteneur, et la rotation est conservée.
- **Changée de conteneur sans réencodage** quand la vidéo est en H.264 ou en HEVC mais dans un autre conteneur (MKV, AVI) : la sortie est un MP4.
- **Convertie** dans tous les autres cas : ProRes, VP8, VP9, AV1, MPEG-4 partie 2, MJPEG, etc. La sortie est un **MP4 en H.264**, profil High, à qualité constante (CRF 18, quasi sans perte visible), avec la même résolution (4K au plus) et la même cadence. Le son est recopié s'il est en AAC, sinon converti en AAC à 192 kbit/s.
- **Le nettoyage reste le même** dans les trois cas : aucune étiquette, aucun chapitre, aucune piste de données, aucune position (ADR 0055 § 3). Le format de la catégorie (orientation, durée) se vérifie sur le fichier de sortie, et l'empreinte se prend sur lui.

### 4. Le worker

- Les conversions passent **une à une**, dans une file à elles (`content_drops:convert`). Une recopie ne l'attend jamais. La file sert à ce qu'un dépôt lourd n'occupe pas tout le processeur de la machine, que partagent l'API et l'agent.
- Les délais sont **proportionnels**. Le téléchargement compte une seconde par 10 Mo, plus une minute. La conversion compte trois fois la durée de la vidéo, plus dix minutes, et quatre heures au plus. Au-delà, ffmpeg est tué et le job réessaie : ce n'est jamais un refus.
- **La place disque** est vérifiée avant de commencer : il faut au moins 2,5 fois le poids du fichier dans le dossier temporaire, sinon le job réessaie plus tard. Le runbook (deploy.md § 4.4) dit quelle place réserver.
- **Le bucket** ne change pas : le brut tombe en 24 h sous `incoming/`, et un envoi inachevé est abandonné au bout d'un jour. Un envoi de 10 Gio prend environ une heure en 4G correcte, ce qui reste bien en deçà.

### 5. Ce qu'elle voit (lot d, écran Contenu)

- Pendant l'envoi : une barre par fichier, avec le temps restant estimé.
- Au-delà de 1 Go, une phrase : « Garde l'écran allumé, en Wi-Fi si tu peux ». Un envoi coupé reprend tout seul quand elle rouvre l'écran.
- Pendant la conversion, le fichier est « En préparation ». Elle n'a rien à faire.
- Un refus garde sa phrase claire, par exemple « Ce fichier n'est pas une vidéo qu'on sait lire : exporte-la en MP4 ».

## Conséquences

- Ses vidéos d'iPhone passent comme aujourd'hui : recopiées sans perte, et vite. La conversion ne sert qu'aux cas rares, mais elle évite qu'un dépôt soit bloqué pour une histoire de format.
- Une longue vidéo à convertir peut occuper la machine jusqu'à une heure. Une seule conversion tourne à la fois, et le reste attend son tour.
- Le stockage grossit avec des originaux plus lourds. Ils restent effacés à leur date (lot c), et le prix de l'Object Storage reste faible à ce volume.
- Le travail se fait dans un lot à part de CR-06, après le lot c :
  - la migration qui relève la contrainte de poids ;
  - les contrats (types admis, poids) ;
  - le flair EBML et RIFF ;
  - le choix entre recopie, changement de conteneur et conversion ;
  - la file de conversion ;
  - les délais et la place disque ;
  - le runbook.

  Des tests sur des fichiers fabriqués par ffmpeg (MKV en VP9, AVI en MJPEG, MOV en ProRes), jamais sur un vrai dépôt, prouvent la sortie et l'absence de métadonnées.
