# 0154. L'IA connaît la bio de la créatrice sur la plateforme

Statut : accepted (« ok 0154 » de Charles le 20/11/2026, 13 h 00 heure de Paris ; demande de Charles du 20/11/2026, 12 h 54 heure de Paris : « que l'IA de chatting ait accès, en plus de la fiche persona, à la bio sur Reveal » ; choix « La bio » sur la carte du 20/11, 12 h 57 ; fil « Donner la bio Reveal à l’IA » ; numéro attribué par le coordinateur le 20/11)
Date : 2026-11-20
Précise : l'ADR 0110 (automatisations de Reveal : les accroches restent régies par son § 1), l'ADR 0018 (ce que la plateforme donne), l'ADR 0079 (la fiche lue par les modèles).

## Contexte

Un fan lit la bio de la créatrice sur son profil Reveal avant de s'abonner, et il lui arrive d'en parler. L'IA ne la connaît pas : elle ne reçoit que la fiche persona. Elle peut donc ne pas comprendre l'allusion, ou dire le contraire de ce que le fan a sous les yeux.

Le connecteur lit déjà le profil de la créatrice (`GET /models/:id`, au plus toutes les 15 minutes, pour reconnaître sa bienvenue et son rappel d'expiration : ADR 0110). Ce profil porte le texte public de la bio (champ `description`), qui est aujourd'hui jeté.

Les accroches cliquables proposées au fan à son abonnement sont déjà traitées par l'ADR 0110 § 1 : reconnues, lues comme « accroche toute faite choisie d'un clic, pas ses mots ». Cette ADR n'y touche pas.

## Décision

1. **Lecture seule.** Le connecteur lit la bio dans le profil qu'il lit déjà, au même rythme. Impera n'écrit jamais la bio sur la plateforme.
2. **Gardée avec le compte.** La dernière bio lue est gardée sur le compte de plateforme de la créatrice, avec l'heure de lecture. Une lecture qui échoue garde la dernière bio connue. Une bio vidée sur la plateforme est vidée chez nous.
3. **Donnée à l'IA comme une donnée.** Le cerveau, la voix et le juge reçoivent la bio dans un bloc délimité, à côté de la fiche, sous le titre « ta bio, que tout abonné a pu lire ». Comme les notes d'un fan, une ligne de la bio tournée comme un ordre au modèle est écartée par le code (filtre d'injection existant). La bio est coupée au-delà de 2 000 caractères.
4. **La bio prime.** Sur un point où la bio et la fiche se contredisent, l'IA suit la bio, parce que le fan l'a lue (choix de Charles, 20/11). Le code ne cherche pas les contradictions ; c'est à l'agence d'aligner la fiche.
5. **Comment elle s'en sert.** Elle peut rebondir quand le fan parle de sa bio, elle ne la récite pas et ne la contredit jamais. Un lien, un pseudo ou une adresse de la bio ne sort jamais dans une réponse : les gardes actuelles sur les liens et les autres plateformes restent seules juges.
6. **Rien ne se relâche.** La bio ne lève aucune garde : détection d'âge, gel des ventes pour un fan en difficulté, droits d'envoi, prix et dégoûts restent appliqués par le code.
7. **Playground et évaluations.** Le Playground lit la même bio gardée que les vrais fans. Les évaluations et les tests n'utilisent que des bios fictives.
8. **Sans bio.** Bio vide, jamais lue ou plateforme qui n'en a pas : le bloc est absent, l'IA travaille avec la fiche seule, comme avant.

## Conséquences

- Une colonne de plus sur le compte de plateforme (texte de la bio, heure de lecture) : migration, propriétaire Bilan.
- Le port des connecteurs gagne une lecture du profil public, derrière une capacité ; FakeReveal la sert.
- Les prompts du cerveau, de la voix et du juge prennent une nouvelle version avec le bloc de la bio.
- Le glossaire gagne « bio » (`profile_bio`).
- Propriétaires : Agent (contexte de l'IA, Playground), Bilan (connecteur, base).
- Ce que la bio ne dit jamais au dépôt : son texte réel. Il reste chez Reveal et dans la base.
