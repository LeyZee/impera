# 0113. Les fichiers du coffre : lus le temps de la description, jamais gardés

Statut : accepted (« ok 0113 » de Charles le 16/11/2026, 12 h 48 heure de Paris, fil de coordination ; numéro attribué par le coordinateur ; fiche `PROPOSED-vault-fetch-media.md` ; relecture Sécurité et Médias)
Date : 2026-11-16
Précise : l'ADR 0018 (`fetchMedia`, drapeau `mediaDownload`), l'ADR 0030 § 3 et § 4 (l'original est lu puis effacé, la vignette reste), l'ADR 0099 § 4, § 5 et § 7 (description par lots dans le budget, la description de la plateforme est un point de départ). Ne remplace rien.

## Contexte

La synchronisation du coffre (#759) remplit `media_platform_refs` : chaque média du coffre a sa liaison, son dossier et sa place, mais aucun fichier (`media_asset_id` vide). Sans fichier, pas de description par la vision, donc pas de script proposable (ADR 0030 § 3) : c'est ce qui manque pour que l'agent vende par scripts.

L'ADR 0099 § 7 renvoie le téléchargement à une fiche à part, après la première lecture réelle des liens. On sait déjà, de la capture, que la plateforme sert les photos par un lien signé à durée limitée et les vidéos par un flux découpé et chiffré, comme un lecteur vidéo les lit. Restent à décider : où vont les octets, vers qui le serveur a le droit de sortir, comment une vidéo devient un fichier lisible, que faire d'un lien expiré, et comment les descriptions s'enchaînent sans dépasser le budget.

## Décision

1. **L'original ne touche jamais le stockage objet.** Le worker lit le fichier dans un dossier temporaire qui n'appartient qu'au job, le décrit, en tire la vignette (ADR 0030 § 4, clé `thumbnail_key`), puis efface le dossier, que le job réussisse ou échoue. La ligne `media_assets` naît effacée (`erased_at` posé, `storage_key` vide), avec son empreinte, son type, sa taille et sa durée, sous une origine à elle, `vault` : `creator` veut dire « déposé par elle », un original qui a existé chez nous, et les règles des dépôts (rétention, vignettes, rattrapage) raisonnent sur lui. Aucune rétention d'original (ADR 0044) ne s'applique donc : il n'y a rien à purger plus tard. Une migration ajoute l'origine et permet `storage_key` vide, seulement pour elle : vide si et seulement si l'origine est `vault` et la ligne effacée. Un écran ne montre jamais un média du coffre comme un original perdu.

2. **Le serveur ne sort que vers une liste fermée d'hôtes, sans rien de la session.** Les hôtes de fichiers de chaque plateforme sont écrits dans le code de son adaptateur, pas dans un réglage : un lien qui en nomme un autre est refusé avant tout appel. La requête ne porte ni cookie, ni jeton, ni en-tête de la session ; elle ne suit aucune redirection. Chaque fichier a un plafond de taille et un délai ; au-delà, le job s'arrête et rien n'est gardé. La liste d'hôtes se fixe sur la première lecture réelle (ADR 0099 § 7), et chaque ajout passe par une PR relue par Sécurité.
   *Avenant du 16/11/2026 (« Oui » de Charles, 23 h 41 UTC, fil Bilan ; relecture Sécurité) :* l'hôte des vidéos attend l'en-tête d'origine du tableau de bord. Le serveur lui envoie donc `Referer`, à valeur fixe (l'adresse publique du tableau de bord), à lui seul : nommé en entier dans la liste, en HTTPS, pour les fichiers du coffre seulement ; aucun autre en-tête, aucun autre hôte, et toujours aucune redirection suivie. Rien de la session n'y est joint. L'avenant vaut aussi pour l'image d'aperçu d'une vidéo du coffre (ADR 0138 § 5), servie par le même hôte : même valeur, aucune seconde constante (accord de Sécurité et de Bilan, 17/11/2026).

3. **Une vidéo se lit comme un lecteur la lit.** Du flux découpé, on prend une seule qualité, la plus haute jusqu'à 720 lignes (assez pour décrire, sans tout télécharger) ; ses morceaux sont déchiffrés avec la clé que la plateforme sert au lecteur, puis mis bout à bout dans le fichier temporaire. Images clés et transcription en sont tirées comme pour un dépôt (ADR 0030 § 3). Un flux qui ne se lit pas (forme inconnue, direct, chiffrement autre) ne bloque rien : le média attend un texte de l'agence (« À décrire par l'agence »), jamais une description inventée (ADR 0099 § 5). Une note vocale n'est jamais donnée à la vision ni mise « À décrire par l'agence » : elle ne bloque pas un script.

4. **Un lien expiré se relit une fois.** Les liens de la liste sont signés pour un temps court. Si la plateforme répond que le lien n'est plus valide, l'adaptateur relit la page du dossier de ce média pour un lien frais, une seule fois ; s'il échoue encore, l'échec est typé et le média revient au passage suivant. Relire un dossier est une lecture : la garde d'écriture (ADR 0018 § 3) n'est pas concernée, et rien n'est jamais envoyé ni modifié sur la plateforme.

5. **La description part par lots, dans le budget, sans doublon.** Un job rejouable (`media.describe_vault`), sur la file du compte, prend les liaisons sans média par lots : d'abord les médias des scripts importés actifs, aperçus compris, en commençant par les scripts à qui il manque le moins de descriptions (ils deviennent proposables les premiers), puis les autres scripts, puis les médias des dossiers dans l'ordre du coffre. Seuls les médias rangés dans un dossier du coffre sont décrits ; un média à la racine ne l'est jamais, même tenu par un script, et le rattrapage de l'heure ne le relance pas (amendement du 16/11, décision de Charles : « prends seulement ce qu'il y a dans les dossiers »). Il s'arrête au plafond du jour du budget IA et reprend toutes les heures, comme les dépôts. Un fichier dont l'empreinte est déjà connue de la créatrice est rattaché au média existant sans nouvel appel de vision. Une description de la vision a la même forme que celle d'un dépôt (texte détaillé, ADR 0083), pour qu'une fois validée elle compte pour les scripts. La description de la plateforme, quand elle existe, devient une ligne `media_descriptions` d'auteur `platform`, jamais validée (ADR 0099 § 4) ; elle n'est jamais prise pour la description du moment : elle n'empêche pas la vision de passer.

## Conséquences

Positives :
- Aucun contenu intime ne reste chez nous au-delà de la vignette, pas même quelques heures dans le stockage.
- Le serveur ne peut pas être poussé à appeler n'importe quelle adresse par une donnée venue de la plateforme.
- Les scripts deviennent proposables dans l'ordre où ils servent à vendre.

Négatives :
- Redécrire un média (nouveau modèle de vision, réessai) demande de relire le fichier sur la plateforme, donc une session valide (déjà le cas, ADR 0030).
- Une vidéo longue se télécharge en entier, dans sa qualité réduite, pour en tirer quelques images : du temps de worker et de la bande passante.
- Un hôte de fichiers que la plateforme change fait échouer les téléchargements jusqu'à la PR qui l'ajoute.

À surveiller :
- La durée réelle de validité des liens et la forme des originaux (L14, L15) : si un lien expire avant la fin d'une longue vidéo, le § 4 relit le dossier et recommence ce fichier.
- Le coût des premières descriptions d'un gros coffre : l'écran montre « décrits / à décrire » par dossier (ADR 0099 § 5).

## Alternatives rejetées

- **Garder l'original quelques heures dans le stockage objet, puis le purger.** C'est le chemin des dépôts, mais il crée une copie à protéger et un job de purge à surveiller, pour aucun gain : le fichier temporaire suffit à la description.
- **Laisser l'extension télécharger depuis le navigateur.** Elle a la session, mais le fichier transiterait par le poste d'un chatteur ; le serveur n'en a pas besoin, puisque le lien du fichier ne demande aucun cookie.
- **Une liste d'hôtes en réglage du CRM.** Plus souple, mais un réglage se change sans relecture ; la sortie réseau du serveur est une question de sécurité, elle passe par le code.
- **Décrire la meilleure qualité disponible.** Plus de détails pour la vision, mais des fichiers bien plus lourds pour quelques images clés.
