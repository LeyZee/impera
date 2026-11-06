# 2026-11-06 — SEC-05 lot 2 : l'écran « Mon chat privé »

- **Fiche** : SEC-05, lot 2, côté écran (l'API est #580, Bilan).
- **Fait** :
  - Réglages › Telegram a un onglet « Mon chat privé » (`?onglet=prive`) pour le propriétaire. Il explique à quoi sert le chat : recevoir le lien « mot de passe oublié », et rien d'autre. « Lier mon Telegram » donne un code à usage unique. « Ouvrir Telegram » ouvre le bot avec le code, et le code reste affiché en chiffres tabulaires avec « Valable jusqu'à HH h MM » pour qui préfère l'écrire au bot. La page relit la liaison toutes les 3 s tant que le code attend, et au retour sur l'onglet. Une fois lié : « Relié à @bot depuis le JJ/MM/AAAA », puis « Délier » après une confirmation.
  - Moi › Sécurité montre le même bloc aux chatteurs et aux managers (ADR 0068 § 5) : Réglages est au propriétaire seul. Une créatrice ne le voit pas, et le serveur le lui refuse aussi (403).
  - Une connexion trop ancienne demande le mot de passe et le code (`Reauth`, qui prend maintenant sa phrase en `hint`), puis relance. Sans bot, le propriétaire est envoyé vers « Bots et groupes » ; les autres sont invités à le demander au propriétaire.
- **Reste** : le lot 3 (mot de passe oublié), à la fusion de l'API.
- **Découvertes** : aucune.
- **Vérifié** : `api.test.ts` (403 de reconfirmation, 403 de rôle, 404, 422 sans bot, 429), `PrivateChat.test.tsx` (code, liaison vue au retour, reconfirmation, sans bot, délier confirmé), `search.test.ts` ; captures Nuit et Jour, ordinateur et téléphone.
