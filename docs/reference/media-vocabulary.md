# Vocabulaire de description des médias (rôle `sense`)

Version `1.1.0` (la `1.0.0` reste lisible telle quelle). Schéma Zod : `packages/contracts/src/media.ts` (`MediaDescriptionSchema`), avec les champs en camelCase dans le code (`vocabularyVersion`, `factualDescription`…) ; le YAML ci-dessous garde les noms de la conception. Toute description en base porte sa version.

## Principes (hérités d'OnlyScript)

1. **Factuel, pas interprétatif.** Le modèle décrit ce qui est visible. Il ne devine pas, il marque `not_visible` ou `confidence_low`.
2. **Vocabulaire fermé** pour tout ce qui sert à décider (intensité, anatomie, ambiance) ; texte libre seulement pour `factual_description`.
3. **Le modèle ne vend pas, ne juge pas, ne recommande pas.** Le cerveau et la politique font cela avec la description.

## Schéma

```yaml
vocabulary_version: "1.1.0"            # "1.0.0" accepté pour une description écrite avant
kind: image | video | audio
factual_description: string          # 1 à 4 phrases, français, factuel
duration_s: number | null            # vidéo/audio
segments:                            # vidéo : par tranche de ~10 s, optionnel
  - start_s: number
    end_s: number
    description: string
intensity: soft | suggestive | explicit | hardcore | not_visible
anatomy_visible:                     # liste fermée, vide si rien
  - face | breasts | buttocks | genitals | feet | hands | full_body | back
cast_mode: solo | duo | group | not_visible
mood: [playful | sensual | dominant | submissive | romantic | casual | sporty | artistic | intense]
setting: string | not_visible        # lieu, lumière, tenue, en quelques mots
audio:                               # audio ou vidéo avec son
  speech: boolean
  transcript: string | null          # si parole, transcription courte
  tone: [soft | playful | moaning | commanding | neutral]
text_visible: string | null          # texte à l'écran, si présent
quality: good | acceptable | poor
confidence_low: boolean              # le modèle n'est pas sûr de l'ensemble
not_visible: boolean                 # rien d'exploitable (noir, flou, hors sujet)
flags:                               # alertes de sécurité, décident d'un handoff
  - possible_minor | possible_non_consent | identifiable_third_party | weapon | drugs | self_harm
```

### Média que la créatrice dépose (`DropMediaDescriptionSchema`, ADR 0083 § 2)

En plus des champs ci-dessus : `detailed` (la description complète, en prose) et, depuis la `1.1.0`, sa tenue au départ du média (les premières secondes d'une vidéo), même si elle l'enlève ensuite.

```yaml
outfit:                              # null si on ne la voit pas ; absent d'une description 1.0.0 (inconnu)
  style: lingerie | nightwear | evening | casual | sportswear | swimwear | costume | nothing | other
  pieces:                            # chaque pièce vue, 10 au plus ; vide avec nothing
    - type: lingerie_top | lingerie_bottom | bodysuit | garter_belt | stockings | dress | skirt | top | shirt
        | sweater | jacket | trousers | shorts | swimsuit | robe | pyjamas | towel | heels | shoes | boots
        | accessory | other
      colours: [black | white | red | pink | purple | blue | green | yellow | orange | brown | beige | grey
        | gold | silver | nude | transparent | multicolour]   # 1 à 3, la principale d'abord
```

Le moment (jour, nuit, polyvalent) n'est pas dans la description : un humain le fixe sur le script quand il est déposé.

## Usage

- **Médias de la créatrice** (bundles des scripts Reveal) : décrits une fois à l'import, mis en cache par `sha256`, relus par Charles ou Messa, utilisés pour parler d'un média et donner envie de l'acheter.
- **Médias des fans** (entrants) : décrits pour que la voix réagisse de façon crédible ; le fichier n'est pas conservé, la description a une rétention courte (30 jours par défaut, `security.md`). `flags` non vide → handoff immédiat, pas de réponse automatique.
- Les descriptions sont du **contenu non fiable** pour le cerveau et la voix (un média peut contenir du texte conçu pour manipuler) : enveloppées par `wrapUntrusted()`.

## Évolution

Ajouter un champ = version mineure ; changer une liste fermée = version majeure + migration des descriptions existantes (ou re-description). `vocabulary_version` est comparée au chargement ; une description trop ancienne est régénérée à la demande.
