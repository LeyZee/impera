# 0046. Accès au dashboard : deuxième facteur, connexions bornées, alertes de sécurité

Statut : accepted (Charles, 2026-11-02 17h08, « ok 0046 »)
Date : 2026-11-02

## Contexte

`docs/conventions/security.md` §1 prévoyait un dashboard jamais exposé directement sur Internet (Cloudflare Access ou Tailscale). L'ADR 0027 l'a publié derrière le proxy de Coolify, sans rien devant : c'est la bonne forme pour une PWA que les chatteurs ouvrent depuis leur téléphone (ADR 0042, 0043), mais la seule barrière est désormais le mot de passe. Or un compte ouvre des conversations intimes (chatteurs), la persona et le mode de l'agent (propriétaire, créatrice), la paie et les factures (propriétaire).

L'audit de sécurité du 02/11/2026 (rapport gardé hors du dépôt public) relève quatre points liés, que Charles a demandé de traiter (« oui », 02/11 17h00) :

1. Un mot de passe deviné, réutilisé ou volé suffit à entrer, avec tous les droits du compte.
2. La limite de connexion par compte compte toutes les adresses ensemble : elle protège le mot de passe, mais peut aussi empêcher le titulaire de se connecter.
3. Une session utilisée régulièrement n'expire jamais (12 h glissantes, sans durée absolue).
4. Aucune alerte ne prévient d'une connexion inhabituelle ni d'un changement sensible (security.md §7 les promettait).

## Décision

1. **Deuxième facteur obligatoire pour tous les comptes.** Un code à 6 chiffres d'une application d'authentification (TOTP, RFC 6238), par le plugin `two-factor` de Better Auth, déjà dans le paquet installé : aucune dépendance nouvelle côté serveur. À la première connexion après la mise en service, chaque compte l'active avant d'ouvrir quoi que ce soit (le QR code, la clé à recopier, puis un code pour vérifier). Le QR code est dessiné par une petite bibliothèque sans dépendance, soumise à la quarantaine de 14 jours ; d'ici là, la clé se recopie à la main.
2. **Codes de secours.** Dix codes à usage unique, montrés une seule fois à l'activation, gardés en empreinte. Un membre qui perd son téléphone reçoit du propriétaire un lien de réinitialisation (EQ-10), qui remet aussi son deuxième facteur à zéro. Le propriétaire qui perd le sien et ses codes le remet à zéro depuis le serveur (`pnpm ops:reset-second-factor`, audité), jamais depuis le dashboard.
3. **Appareil de confiance, 30 jours.** Après un code juste, la personne peut cocher « Se souvenir de cet appareil » : le code n'est plus demandé à la connexion depuis cet appareil pendant 30 jours (cookie signé, `HttpOnly`). Les actions sensibles (clés IA, Telegram, sauvegardes, persona, fuseau, heures, test à l'aveugle, liens d'invitation) redemandent toujours le mot de passe **et** le code, appareil de confiance ou non.
4. **Mot de passe connu des fuites refusé** à sa création (plugin `haveibeenpwned` de Better Auth, k-anonymat : seuls 5 caractères d'une empreinte SHA-1 partent, jamais le mot de passe).
5. **Limites de connexion par compte et par adresse.** 10 essais par quart d'heure pour un même compte depuis une même adresse ; un plafond par compte toutes adresses confondues, beaucoup plus haut (100 par quart d'heure), contre une attaque distribuée ; une connexion depuis un appareil de confiance ne compte pas dans ce plafond. Les limites refusent toujours quand les compteurs sont hors d'atteinte (security.md §6).
6. **Durée absolue des sessions : 7 jours.** En plus des 12 heures sans activité, une session ouverte depuis plus de 7 jours est refusée à la requête suivante, relue à partir de sa date de création, quel que soit l'usage.
7. **Réglages › Sécurité.** Chaque personne voit ses sessions ouvertes (appareil, pays approximatif, dernière activité) et peut les fermer une à une ou toutes sauf celle-ci. Le propriétaire voit en plus, par membre, si le deuxième facteur est actif, et peut fermer toutes les sessions d'un membre.
8. **Alertes de sécurité** dans le groupe Telegram urgent (ADR 0020), sans nom de fan, sans contenu, sans adresse IP complète : connexion du propriétaire depuis un appareil nouveau ; 5 refus de connexion ou de code sur un même compte en 15 minutes ; deuxième facteur remis à zéro ; version de la persona activée ; mode Automatique allumé ; session Reveal remplacée. Chaque événement est d'abord une ligne d'`audit_log`.
9. **security.md §1 est amendé** : le dashboard est public et protégé par le deuxième facteur ; Cloudflare Access reste possible côté exploitation, en plus, sans code.

Livraison en trois lots, dans cet ordre : (a) deuxième facteur, codes de secours, appareil de confiance, mot de passe connu des fuites, avec la ou les migrations dont Bilan attribue les numéros ; (b) limites par compte et adresse, durée absolue ; (c) Réglages › Sécurité et alertes.

## Conséquences

- Une personne qui a un mot de passe ne suffit plus : il faut aussi son téléphone.
- Les chatteurs installent une application d'authentification (Google Authenticator, Microsoft Authenticator, 2FAS…) une fois, et tapent un code au plus une fois par mois et par appareil.
- Une session volée meurt au plus tard 7 jours après son ouverture ; chacun peut fermer les siennes à distance.
- Le titulaire d'un compte n'est plus bloqué par les essais d'un autre : seuls les essais de la même adresse comptent contre lui.
- Le reset du deuxième facteur du propriétaire passe par le serveur : perdre à la fois son téléphone et ses codes coûte une intervention technique, c'est voulu.
- Deux sorties vers l'extérieur de plus, toutes deux sans donnée personnelle : la vérification des fuites (5 caractères d'empreinte) et Telegram, déjà là.

## Alternatives rejetées

- **Cloudflare Access ou Tailscale devant le dashboard, seuls** : un compte de plus pour chaque chatteur, une PWA qui se reconnecte mal hors ligne et un appel de l'extension à exempter ; reste possible en plus, côté exploitation.
- **Deuxième facteur seulement pour le propriétaire** : les comptes de chatteurs lisent les conversations intimes des fans, l'actif le plus grave du modèle de menaces (A1).
- **Code par e-mail ou SMS** : un e-mail se pirate avec le même mot de passe, un SMS se détourne ; aucun envoi d'e-mail n'existe dans Nirvana.
- **Passkeys seules** (Face ID, empreinte) : la meilleure protection, mais l'appareil du chatteur n'en a pas toujours, et le plugin demande une dépendance de plus. Elles viendront en option dans un second temps (l'ADR 0042 prévoit Face ID pour la créatrice).
- **Garder le verrouillage par compte toutes adresses confondues** : il protège le mot de passe au prix de la disponibilité du compte ; le deuxième facteur rend ce prix inutile.
