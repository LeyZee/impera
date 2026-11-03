# 0060. Veille et idées de contenu : des signaux de sources propres, des idées filtrées par le code, validées par l'agence, proposées à la créatrice

Statut : accepted (Charles, 03/11/2026, 11 h 32, « je te donne mon OK aux deux ADR qui attendent » ; capture passive par l'extension : « Go extension alors ;) », 11 h 34 ; « c'est moi qui va pouvoir scroll […] il n'y a pas besoin de payer quelqu'un », 11 h 34 ; demande de Charles du 03/11/2026, 11 h 19, fil « Faire la veille Instagram pour les modèles » ; étude et variantes : `/mnt/project-files/veille-instagram/`, hors dépôt)
Date : 2026-11-03
Précise : l'ADR 0042 (§ 4 suggestions et fiche de tournage ; catégorie « Réseaux » de l'agenda, remplie par ce chantier), l'ADR 0055 (§ 1 catégories, § 4 demande de contenu), l'ADR 0056 (§ 2 file des structures), l'ADR 0057 (§ 1 API officielles seulement, § 3 statistiques à 48 h, § 6 garde Instagram), l'ADR 0030 (description validée), l'ADR 0010 (aucune donnée réelle dans le dépôt).

## Contexte

Charles veut aider chaque créatrice à trouver chaque jour quoi tourner, sans qu'elle cherche : repérer les tendances liées aux créatrices sur Instagram, les croiser avec ce qu'elle fait déjà, ce qu'elle aime et ce qu'elle sait faire (son compte public et sa persona), et lui proposer des contenus qui font des vues et qu'elle est capable de faire.

Vérifié le 03/11 (documentation de Meta) :

- Le compte professionnel de la créatrice, branché par l'ADR 0057, donne ses médias, ses légendes et leurs statistiques (vues, portée, j'aime, commentaires, partages, enregistrements).
- « Business Discovery » donne, pour un compte professionnel nommé, ses médias avec `like_count`, `comments_count` et `view_count` ; il passe par la voie Facebook Login et ne renvoie pas les comptes à âge restreint.
- La recherche par hashtag est bornée à 30 hashtags par 7 jours glissants, demande une revue de Meta, refuse les hashtags jugés sensibles.
- Aucune API ne donne le fil d'un utilisateur, l'onglet Reels, l'Explorer, les sons tendance ou les collections enregistrées.
- Les conditions d'Instagram interdisent la collecte automatisée sans autorisation ; l'ADR 0057 § 1 n'admet déjà que les API officielles, pour tout réseau.

## Décision

### 1. Aucun agent ne navigue sur un réseau

- Aucun agent, interne ou externe (ADR 0026, 0058), ne navigue sur Instagram ni sur un autre réseau : ni avec le compte d'une créatrice, ni avec un compte de l'agence, ni sans compte. L'ADR 0057 § 1 s'applique à la lecture comme à la publication.
- **La capture passive n'est pas une navigation.** L'extension Chrome de Nirvana peut relever ce qu'une personne regarde elle-même sur instagram.com (§ 2, source 6). Elle ne fait jamais défiler, ne clique jamais, n'ouvre aucune page et n'envoie aucune requête à Instagram ; elle lit seulement ce que la page affiche déjà, depuis le monde isolé de l'extension, sans modifier le JavaScript de la page ni lui exposer aucune ressource.
- Nirvana ne télécharge jamais le contenu d'un tiers. D'un post repéré, il garde le lien, la note de la personne qui l'a repéré et, s'il vient d'une API, ses chiffres publics.

### 2. Les signaux

- Un **signal de tendance** (`trend_signal`) dit qu'un format, un son, un thème ou une date monte. Il a une source, un texte court, un lien facultatif, un format, des chiffres facultatifs, une date et une **péremption** (14 jours par défaut, réglage d'agence) ; un signal périmé n'est plus lu.
- Cinq sources, toutes officielles ou humaines, chacune un adaptateur derrière un port du module, avec son faux pour les tests :
  1. **les statistiques de la créatrice**, par son connecteur Instagram (ADR 0057) ;
  2. **la recherche de Grok** sur X et le web, une fois par jour pour toute l'agence ; Grok rend des signaux sourcés, jamais une idée ;
  3. **une liste de comptes de référence** choisie par l'agence, lue par Business Discovery depuis le compte professionnel de l'agence ; un post qui dépasse nettement la moyenne de son compte devient un signal ;
  4. **un membre de l'agence** qui colle un lien dans Nirvana avec une ligne et un format (partage depuis Instagram sur Android, coller sur iPhone) ;
  5. **la créatrice**, si elle le veut, par le même geste depuis sa PWA ;
  6. **la capture passive par l'extension** : quand un membre de l'agence ou la créatrice active « Veille » dans l'extension et regarde les Reels, l'Explorer ou le profil d'un compte sur instagram.com, l'extension relève, pour chaque post affiché, son lien, le nom du compte, les vues, j'aime et commentaires quand la page les affiche, sa légende et ses hashtags, le nom du son et le temps passé dessus ; un geste de l'extension marque un post pour une créatrice. Elle ne relève jamais les messages privés, les stories, un compte privé, ni le média lui-même. La veille s'arrête seule au bout de 45 minutes ou quand on quitte Instagram, et l'extension montre qu'elle relève. Un post relevé devient un signal s'il a été marqué, ou si ses chiffres dépassent nettement la moyenne de son compte ; les relevés suivent la péremption des signaux. Si la page change et que le relevé échoue, l'extension le dit en ambre et ne recharge jamais la page pour réessayer. Les relevés de test sont fabriqués, jamais enregistrés sur de vrais comptes (ADR 0010).
- La veille est un geste de l'agence, fait par un de ses membres sur son propre navigateur : elle n'ouvre ni shift, ni rémunération, ni ligne de paie.
- La recherche par hashtag n'est pas une source de cette ADR.

### 3. Le profil de contenu

- Chaque créatrice a un **profil de contenu** (`content_profile`), distinct de sa persona : ce qui marche chez elle (formats, thèmes, durées, heures, d'après ses statistiques), ce qu'elle sait faire et a sous la main (décors, tenues, accessoires, animaux, passions filmables).
- Il est rédigé par le modèle de vision à partir de **ses propres médias**, lus par son connecteur, ou, avant le branchement, par l'export officiel de ses données Instagram qu'elle dépose. Jamais en lisant une page d'Instagram.
- C'est un brouillon relu par le propriétaire ou un manager ; seule la version validée est lue par la génération, et une nouvelle génération ne l'écrase jamais (comme l'ADR 0030).
- Le profil, les descriptions et les signaux vivent en base, sous la RLS de l'agence. Aucun ne va dans le dépôt, une fixture ou une éval (ADR 0010).

### 4. Les idées du jour

- Chaque matin (7 h dans le fuseau de la créatrice), un job rejouable produit pour chaque créatrice active **au plus 3 idées de contenu** (`content_idea`). Le modèle de langage reçoit les signaux vivants, le profil validé, la persona et les idées des 30 derniers jours, par la passerelle LLM, avec un prompt versionné et un schéma Zod : titre, catégorie de dépôt (ADR 0055 § 1), ce qu'il faut tourner, signal d'origine, raison en une phrase, temps de tournage estimé.
- **Filtres du code**, après la génération, jamais confiés au prompt :
  - une idée qui touche un dégoût ou une limite de la persona est retirée (même filtre que l'ADR 0056 § 1) ;
  - une idée trop proche d'une idée des 30 derniers jours est retirée ;
  - **une idée refusée n'est jamais reproposée** ;
  - une idée pour une sortie publique respecte « jamais de nu » dans son texte, et pour Instagram la garde de l'ADR 0057 § 6 ;
  - une idée qui ne cite pas un signal vivant est retirée.
  Si tout est retiré, il n'y a pas d'idée ce jour-là.
- Une idée de sorte **thème de script** ne crée jamais de structure : l'agence l'ajoute ou non à la file de structures de la créatrice (ADR 0056 § 2).

### 5. La validation de l'agence, puis la créatrice

- Les idées arrivent dans **« Idées du jour »**, un écran du propriétaire et des managers : une carte par idée, rendue comme un carton (ADR 0056 § 3). Trois gestes : valider, corriger sur place, refuser avec un motif facultatif. Rien ne part chez la créatrice sans validation.
- Une idée validée devient une **suggestion** dans son agenda (ADR 0042 § 4), sous forme de fiche de tournage, dans un de ses créneaux ouverts. Elle l'accepte ou la refuse d'un geste ; acceptée, elle devient une demande de contenu (ADR 0055 § 4), catégorie déjà choisie.
- Au plus **une notification par jour** pour ses idées, dans ses heures, jamais pendant ses heures calmes.
- Elle ne voit jamais l'IA, ni son profil de contenu (ADR 0042).

### 6. Le retour

- Le dépôt né d'une idée garde le lien vers elle. Ses statistiques à 48 h (ADR 0044 § 4, ADR 0057 § 3) reviennent sur l'idée et sur son signal. La génération suivante reçoit ces résultats comme des faits ; un chiffre qu'elle écrirait sans l'avoir reçu est refusé (ADR 0042 § 5).
- Le topo du dimanche (ADR 0042 § 5) résume les idées de la semaine et ce qu'elles ont donné ; il ne produit pas d'idées de contenu réseaux de son côté.

### 7. Le budget

- La veille a son **plafond propre** dans le budget IA (1 € par jour par défaut, réglage du propriétaire). Au plafond, les jobs de veille s'arrêtent jusqu'au lendemain et l'agence le voit en ambre ; la réponse aux fans n'est jamais privée de budget par la veille.

## Conséquences

Positives :
- La créatrice reçoit chaque jour quelques idées faisables, reliées à une tendance réelle, sans chercher, et l'agence garde la main.
- Aucun compte n'est mis en danger : pas de navigation automatisée, pas de scraping, API officielles, gestes humains et relevé passif de ce qu'un humain regarde.
- Le coût reste sous 1 € par jour pour cinq créatrices.

Négatives, à surveiller :
- Sans humain qui regarde (capture passive) ou qui partage, les sons tendance ne viennent que de seconde main (Grok) : la qualité des idées dépend de ce geste quotidien.
- Business Discovery demande un compte professionnel de l'agence relié à une page Facebook et une revue de Meta, et ne voit pas les comptes à âge restreint.
- Le profil de contenu n'a pas de statistiques tant que le compte de la créatrice n'est pas branché (PUB-02).
- La capture passive suit la forme des pages d'Instagram, qui change souvent : elle cassera, et se répare dans l'extension. Elle ne marche que sur ordinateur.
- Les conditions de Meta interdisent la collecte automatisée sans autorisation ; relever ce qu'un humain regarde, sans rien changer au comportement du compte, reste une zone grise que l'agence accepte.

## Alternatives rejetées

- **Un agent qui fait défiler Instagram avec le compte de la créatrice**, que ce soit par un serveur, par l'API de débogage du navigateur ou par le navigateur d'un membre de l'agence : contraire aux conditions d'Instagram, détectable par le pilotage et par le comportement, et le risque porte sur son compte, qui est sa source d'acquisition.
- **Un agent qui fait défiler Instagram avec un compte de veille de l'agence** : même interdiction, le risque passe sur ce compte ; contredit l'ADR 0057 § 1. À rouvrir par une ADR seulement si la capture passive et les autres sources ne suffisent pas après deux semaines d'essai.
- **Un service tiers de scraping** : zone grise juridique et un fournisseur de plus qui verrait nos listes ; l'ADR 0057 l'écarte déjà pour la publication.
- **Des idées envoyées à la créatrice sans validation** : trop tôt pour faire confiance à la génération ; à rouvrir par un réglage quand le taux de validation le justifiera.
- **La recherche par hashtag au cœur** : 30 hashtags par semaine, revue de Meta, hashtags sensibles refusés ; trop pauvre pour notre niche.
