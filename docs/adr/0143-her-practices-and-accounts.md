# 0143. Ses pratiques et savoir-faire, et ses comptes : l'agent en parle juste, sans rien inventer, et oriente le fan vers le bon compte

Statut : accepted (demande de Charles du 16/11/2026, 16 h 13 à 17 h 05, fils du projet et Bilan ; acceptée par Charles le 16/11/2026, « ok 0143 » ; relecture Sécurité des § 9, 10 et 15 avant fusion)
Date : 2026-11-16
Précise : ADR 0079 (fiche persona au format 2), ADR 0021 (rester en personnage), ADR 0088 (mode soin), ADR 0126 (lives), P4-01 (alertes par mot-clé). Amende la règle « ne jamais renvoyer hors de la plateforme » pour les seuls comptes que le propriétaire marque comme transmissibles. Ne remplace aucun ADR.

## Contexte

Une créatrice peut avoir une pratique qu'elle maîtrise et dont elle parle avec ses propres mots : un art, une discipline, un savoir-faire qu'elle enseigne (exemple fictif : la danse aérienne). Charles veut que l'agent en parle comme elle, sans erreur : un fan qui s'y connaît repère tout de suite quelqu'un qui récite. Il veut aussi que l'agent explique les petits mots qu'elle emploie, y compris dans l'accroche de son profil.

Aujourd'hui, la fiche n'a pas de place pour ça. On peut écrire la pratique dans « Pratiques / Kinks » (panneau Intimité), mais c'est la ranger dans la sexualité alors qu'elle peut ne pas l'être, et 4 000 caractères se partagent avec tout le reste. Rien ne dit non plus à l'agent de s'en tenir à ce qui est écrit.

Charles décide aussi (16/11) :
- un fan qui cherche un compte de la créatrice : l'agent lui dit de taper son nom de scène ;
- la créatrice a des comptes par usage (les lives, sa pratique, son compte personnel) : l'agent donne le bon selon ce que le fan cherche ;
- un fan vraiment intéressé par sa pratique peut se voir proposer, par l'agent lui-même, ce qu'elle offre autour (atelier, formation en groupe en ligne, séance privée, cours en direct, séance photo), en l'orientant vers le compte de sa pratique, où il postule et remplit un questionnaire ; une demande dans la conversation n'est jamais une acceptation ;
- le mot « rencontre » ne met plus l'agent en pause : elle répond elle-même que c'est trop tôt, qu'elle a besoin d'être en confiance.

## Décision

### A. La section « Ses pratiques et savoir-faire »

1. **Un panneau de plus dans la fiche** (format 2, `PersonaSheetSchema`), hors du panneau Intimité : une liste de pratiques, 5 au plus. Pour chacune, des champs libres :
   - le nom de la pratique ;
   - son niveau, son rôle, depuis quand ;
   - comment elle en parle, avec ses mots, et ce que ça représente pour elle (pourquoi, dans quelles circonstances) ;
   - son vocabulaire : les mots qu'elle emploie et ce qu'ils veulent dire ;
   - ce qu'elle respecte (sa sécurité, son cadre) ;
   - ses anecdotes ;
   - ce qu'elle propose autour (ateliers, séances…) et à qui ;
   - quoi répondre à un curieux, à un débutant, à un fan qui veut essayer ;
   - ce qu'elle ne dit jamais, et si la pratique est sexuelle pour elle ou non (« non » par défaut).
   Chaque champ libre est long (`SHEET_LONG_MAX`), et la pratique entière tient dans une limite plus large que les autres champs (8 000 caractères), parce que sa cohérence vient du détail.

2. **Compatibilité** : une version de persona déjà enregistrée lit une liste vide. Aucune donnée existante n'est déplacée par le code ; le propriétaire recopie dans une nouvelle version ce qui était ailleurs.

3. **Au modèle**, la section est rendue dans un bloc à part, `<her_practices>`, jamais dans le bloc de l'intimité. Une pratique marquée non sexuelle est dite telle : le modèle ne la sexualise jamais de lui-même. Le bloc n'est donné que quand le fan parle d'une de ces pratiques (son nom ou un mot de son vocabulaire, trouvé par le code, ou lu par le cerveau), pour ne pas en nourrir chaque réponse.

### B. Ce que l'agent en dit

4. **Il s'en tient à la fiche.** Sur une question dont la réponse n'est pas écrite, elle esquive avec naturel (elle préfère montrer qu'expliquer, elle en parlera une autre fois) : elle n'invente ni technique, ni chiffre, ni anecdote.
5. **Jamais de mode d'emploi.** Elle ne donne aucun conseil technique ni de sécurité à un fan pour pratiquer seul, même si la fiche en contient : la fiche lui sert à parler juste, pas à former.
6. **Âge non confirmé** : la pratique se raconte sans rien de sexuel, comme le reste. Une pratique sexuelle pour elle suit le curseur de sexualisation.

### C. Ses comptes

7. **« Ses comptes »**, dans le profil de la créatrice : pour chaque compte, la plateforme, le nom d'utilisateur, l'usage (lives, sa pratique, personnel, autre), et un interrupteur « l'agent peut le donner ». Saisis par le propriétaire dans le CRM. Ce sont des données réelles : jamais dans le dépôt, une fixture ou un prompt versionné. « Mes liens » (liens de redirection, ADR 0120) reste un autre objet et n'entre dans aucun prompt.
8. **Un fan cherche un compte** : elle lui dit de taper son nom de scène. Le nom d'utilisateur précis n'est donné que pour l'usage qu'il cherche, et seulement d'un compte marqué « l'agent peut le donner ». Jamais de lien.
9. **Exception explicite** : un compte marqué transmissible sort, pour son usage, de toute limite de la fiche qui interdit de parler de ses autres plateformes. Le reste de la limite tient.

*Avenant du 27/11/2026 (décision de Charles, 15 h 47, méthode § 10.27 Q3) : la garde de sortie de Reveal laisse passer exactement deux comptes de la créatrice, et eux seuls. Son Instagram, seulement quand le fan le demande vraiment (voir sa wishlist en story à la une, une cam, ou son Insta lui-même) ; son TikTok, pour ses lives (§ 11 bis de l'ADR 0126). Ils sont saisis par le propriétaire dans sa fiche du CRM, onglet « Règles strictes » (`agent.rules.own_accounts`, `{ instagram, tiktok }`), à côté des listes que les gardes appliquent : la fiche versionnée tient lieu, pour ces deux comptes, de « Ses comptes » du § 7 (l'historique des versions vaut l'audit du § 20 ; pas d'interrupteur, un pseudo saisi vaut « l'agent peut le donner » dans son seul usage). Le code les lit dans la version active à chaque brouillon et à chaque approbation, compare le pseudo écrit au pseudo saisi après la seule normalisation de la casse et du « @ » initial (pas de « contient », pas de sosie, pas de lien, même vers ce compte, ni de lien raccourci), et ne l'ouvre que dans son contexte, lu par le code dans les messages du fan depuis la dernière réponse (en français, anglais, espagnol et italien) ou, pour TikTok, dans la réponse qui parle d'un live. Le pseudo n'entre dans aucun prompt, donc dans aucun journal des appels (relecture Sécurité du 27/11) : le bloc `<her_accounts>` dit seulement quel compte est ouvert au tour, la voix écrit à sa place un jeton fixe (`{{son_instagram}}`, `{{son_tiktok}}`), et le code met le pseudo lu dans la version active à la place du jeton, avant que les gardes relisent le texte qui part ; un jeton d'un compte fermé, ou sans pseudo saisi, bloque la réponse (réécrite une fois, puis un humain), jamais envoyée telle quelle. Partout où le pseudo est déjà écrit (conversation, bio, notes), les prompts lisent son jeton, et le relevé d'une garde aussi. Elle ne le propose jamais d'elle-même. Mode soin et piège : aucun compte (§ 16). Snap, Telegram, WhatsApp, un numéro, un lien, tout autre pseudo ou tout compte différent du pseudo saisi restent bloqués comme avant ; le nom d'un réseau seul, sans pseudo, se lit comme avant. Les pseudos ne sont jamais dans le dépôt, un test, une doc ni un prompt versionné.*

### D. Ce qu'elle propose autour de sa pratique

10. **Quand le fan s'y intéresse vraiment** (il en parle de lui-même, pose des questions, dit vouloir essayer ou apprendre), elle peut lui proposer ce que la fiche dit qu'elle offre, et l'oriente vers le compte de sa pratique. Elle dit toujours :
    - comment ça se passe : il postule et remplit le questionnaire accessible depuis ce compte ;
    - que sa demande n'est pas une acceptation, et qu'elle peut refuser ;
    - si la fiche le dit, que ce n'est pas sexuel.
11. **Elle ne fixe rien** : ni date, ni lieu, ni prix, ni promesse. Une séance de sa pratique n'est pas un rendez-vous ; un rendez-vous garde le « non » de la fiche et la limite « ne jamais rencontrer un fan ».
12. **Jamais en accroche de vente**, jamais dans une relance, jamais dans un script. C'est une réponse à son intérêt, pas une offre.
13. **Une note pour l'équipe** est posée quand l'agent a orienté un fan vers un compte (`account_shared` : conversation, usage, sans le nom du compte).

### E. Rencontre et mots-clés d'alerte

14. **Une demande de rencontre** : elle répond elle-même, sans pause, que c'est trop tôt, qu'elle a besoin d'être en confiance, sans jamais dire oui ni fixer quoi que ce soit (règle actuelle de la rêverie au conditionnel).
15. **Un mot-clé d'alerte de la persona** ne met plus l'agent en pause sur un message que le code sait déjà traiter : une demande de rencontre (§ 14) ou une demande autour de sa pratique (§ 10). L'alerte part quand même, pour prévenir l'équipe. Sur tout autre message, le mot-clé met en pause comme avant.

### F. Ce qui coupe tout

16. Doute d'âge ouvert, mode soin et sortie de soin (ADR 0088), « ne plus lui écrire », ventes gelées : ni compte donné, ni proposition autour de sa pratique. La pratique peut être racontée, sans rien proposer, sauf pendant un doute d'âge ou un mode soin, où l'agent n'écrit déjà rien ou ne fait que soutenir.

### G. Évals

17. Sur persona fictive : une question sur un mot de son vocabulaire ; une question hors de la fiche (elle n'invente pas) ; un fan qui demande comment pratiquer seul (pas de mode d'emploi) ; un fan intéressé (orientation, questionnaire, pas d'acceptation) ; une demande de rencontre (pas de pause, pas de oui) ; un fan qui cherche son compte (nom de scène) ; un doute d'âge (rien de tout ça).

### H. Bornes tenues par le code (relecture Sécurité, 16/11)

Elles ne changent pas la décision : elles disent où le code tient la règle. Chaque borne a son test dans le lot a.

Comptes (§ 8 et 9) :
18. C'est le code, pas le modèle, qui décide qu'un nom de compte peut sortir à ce tour : usage reconnu, compte marqué, aucune coupure du § 16. Un compte non marqué n'entre dans aucun prompt.
19. Garde de sortie : une réponse qui contient un nom de compte non autorisé à ce tour, ou un lien, est bloquée et réécrite.
20. L'interrupteur « l'agent peut le donner » est éteint par défaut, changé par le propriétaire seul, et chaque changement est audité.

Orientation (§ 10) :
21. Les coupures du § 16 sont revérifiées par le code au moment de l'envoi, pas seulement à la décision.
22. S'ajoute au § 11 : jamais de ville, de région ni d'indication de lieu, même vague.
23. Pas d'orientation pour un fan qui porte un risque ouvert (menace, insistance, harcèlement), et une seule fois par fan sur une période fixée dans le code.

Mot-clé sans pause (§ 15) :
24. L'exception ne vaut que pour les mots-clés liés à ces deux cas. Tout autre mot-clé d'alerte présent dans le même message met en pause comme avant.
25. Les autres gardes passent d'abord et l'emportent : doute d'âge, fan en difficulté, menace.
26. En cas d'hésitation sur la nature du message, c'est la pause : l'exception demande une décision nette du code, jamais un « peut-être ».
27. Un fan qui cite un lieu, une date ou une adresse, ou qui laisse entendre qu'il sait où elle se trouve : pause et alerte, pas de réponse de l'agent.
28. Une insistance répétée sur la rencontre (seuil fixé dans le code) remet la pause.
29. La garde de sortie refuse toute réponse qui dit oui ou qui fixe quoi que ce soit ; l'alerte part dans tous les cas.

## Lots

- **a, Agent** : schéma de la section et de « Ses comptes » (contracts), rendu `<her_practices>`, règles B à F dans le code, `account_shared`, évals.
- **b, Design** : le panneau de la fiche et « Ses comptes » dans le profil de la créatrice.
- **Sécurité** : relecture des § 9, 10 et 15 avant fusion.
- **Bilan** : la nouvelle version de la persona sur le PC, une fois a et b fusionnés.

## Conséquences

Positives :
- L'agent parle de sa pratique comme elle, sans la ranger dans la sexualité.
- Un fan intéressé est orienté vers le bon endroit, sans que l'agent promette quoi que ce soit.
- Une demande de rencontre ne bloque plus la conversation.

Négatives, à surveiller :
- Une exception de plus à « rester sur la plateforme » : bornée aux comptes marqués et aux usages demandés, journalisée.
- Retirer la pause d'un mot-clé sur deux cas : l'alerte reste, et l'équipe voit la note.
- Une pratique mal décrite donne des réponses floues : l'agent esquive plutôt qu'inventer, à relire au Playground.

## Alternatives rejetées

- **Garder la pratique dans « Pratiques / Kinks »** : elle serait lue comme sexuelle, et la place manque.
- **Une catégorie réservée à une seule créatrice** : la section est générique, chaque créatrice la remplit ou non.
- **Passer la main à un humain dès qu'un fan s'intéresse** : Charles préfère que l'agent oriente lui-même, sous les gardes ci-dessus.
- **Mettre les comptes dans « Mes liens »** : ce sont des liens de redirection, exclus des prompts ; un compte n'en est pas un.
