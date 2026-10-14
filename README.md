# Animateur de Photos Produit

Transformez **une photo de produit statique** en **vidéo publicitaire animée** :
l'application construit le prompt, appelle un **moteur image-to-video** (Veo,
fal.ai ou Replicate), puis assure toute la post-production — texte promotionnel
intégré, coupe à la seconde exacte, ambiance sonore ou silence total.

Conçue pour le e-commerce et le marketing : vêtements, objets, tech.

---

## Sommaire

- [Ce que fait l'application](#ce-que-fait-lapplication)
- [Démarrage rapide](#démarrage-rapide)
- [Les 6 champs du formulaire](#les-6-champs-du-formulaire)
- [Choisir un moteur](#choisir-un-moteur)
- [Comment la vidéo est produite](#comment-la-vidéo-est-produite)
- [Durées : la correspondance avec chaque moteur](#durées--la-correspondance-avec-chaque-moteur)
- [Texte promotionnel intégré](#texte-promotionnel-intégré)
- [Audio et « Pas de son »](#audio-et--pas-de-son)
- [Mode démo (sans clé API)](#mode-démo-sans-clé-api)
- [Suggestions de messages](#suggestions-de-messages)
- [Coûts et temps de production](#coûts-et-temps-de-production)
- [Configuration](#configuration)
- [API HTTP](#api-http)
- [Tests](#tests)
- [Architecture](#architecture)
- [Dépannage](#dépannage)
- [Limites connues](#limites-connues)

---

## Ce que fait l'application

1. **Zone d'upload** pour la photo du produit (glisser-déposer, parcourir, ou
   collage `Ctrl+V`).
2. **Nom du produit** — guide l'animation et s'affiche à l'écran.
3. **Message publicitaire** — ex. « Nouveau ! -30% cette semaine ».
4. **Type de vidéo** — rotation 360° élégante, produit en action, unboxing
   dramatique, avant/après transformation.
5. **Ambiance sonore** — corporate professionnel, énergique et fun, luxe et
   élégant, pas de son.
6. **Durée** — 5 s, 8 s ou 15 s.
7. **Bouton « Animer mon produit »** — lance la production et suit son
   avancement en temps réel.

Le résultat : une vidéo MP4 avec **animation fluide du produit**, **texte
promotionnel intégré** et **audio conforme à l'ambiance choisie**, téléchargeable
en un clic.

---

## Démarrage rapide

```bash
npm install --ignore-scripts   # voir la note ci-dessous
npm start
```

Puis ouvrez <http://127.0.0.1:5178>.

### Pourquoi `--ignore-scripts` ?

Le paquet `@ffmpeg-installer/ffmpeg` embarque **le binaire ffmpeg directement
dans son archive npm** : aucune compilation, aucun téléchargement annexe.
`--ignore-scripts` évite simplement d'exécuter des scripts de cycle de vie
inutiles, ce qui rend l'installation fiable jusque dans les environnements
confinés (CI durcie, conteneurs, bacs à sable qui refusent les processus
enfants). Si vous préférez la commande standard, `npm install` fonctionne
aussi.

### Activer un moteur

L'application démarre en **rendu local de démonstration** tant qu'aucune clé
n'est renseignée. Pour activer un vrai moteur, cliquez sur **« Réglages »** et
renseignez **une seule** des clés suivantes — le premier moteur configuré est
utilisé :

| Moteur | Ce qu'il apporte | Clé |
|---|---|---|
| **Veo 3.1** (Google) | Le meilleur rendu : audio natif, texte bien intégré, cohérence du produit. **Nécessite une facturation Google active** (palier Tier 1). | [Google AI Studio](https://aistudio.google.com/apikey) |
| **fal.ai** | Modèles ouverts (Wan, LTX) ou propriétaires (Kling, Hailuo), facturés à la seconde, bien moins chers. Crédits offerts à l'inscription. | [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) |
| **Replicate** | Catalogue très large, utile pour comparer plusieurs modèles. Facturé à la seconde. | [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens) |

Les clés sont conservées **côté serveur** (fichier `.env`) et ne sont jamais
renvoyées au navigateur. Vous pouvez aussi les placer directement dans `.env` :

```bash
cp .env.example .env
# puis renseignez GEMINI_API_KEY=… ou FAL_KEY=… ou REPLICATE_API_TOKEN=…
```

Le serveur n'écoute que sur `127.0.0.1` par défaut : ni les photos, ni les
vidéos, ni les clés ne sortent de la machine.

> **Avant d'acheter quoi que ce soit** : lancez `node scripts/probe-key.mjs`
> pour vérifier ce que votre clé Gemini a réellement le droit d'appeler. C'est
> l'outil qui distingue une vraie limite de débit d'une absence d'accès.

---

## Les 6 champs du formulaire

### Les champs du formulaire

| Champ | Rôle |
|---|---|
| **Photo du produit** | Image source de l'animation. JPEG, PNG ou WebP, 25 Mo max. Elle est normalisée (redimensionnée à 1920 px max, ré-encodée en JPEG) avant l'envoi au moteur. Le cadrage (16:9 ou 9:16) est déduit de ses dimensions, sauf choix manuel. |
| **Nom du produit** | Repris **mot pour mot** dans le prompt pour que le moteur préserve le produit, et affiché en bandeau haut dans la vidéo (60 caractères max). |
| **Message publicitaire** | Le texte promotionnel incrusté dans la vidéo (120 caractères max). Découpé automatiquement en lignes courtes pour rester lisible. Un bouton propose 5 accroches générées. |
| **Type de vidéo** | Détermine la mise en scène, le mouvement et le rythme (11 choix, voir ci-dessous). |
| **Ambiance sonore** | Détermine la musique décrite au moteur, et si nécessaire la suppression ou la synthèse locale de l'audio (11 choix). |
| **Durée** | 5, 8 ou 15 secondes — traduite en plan de production réel selon le moteur. |

**Options avancées** : **moteur de génération** (Veo / fal.ai / Replicate /
rendu local), cadrage (auto / 16:9 / 9:16), définition (720p / 1080p), modèle
Veo, et mode de rendu du texte.

### Les onze types de vidéo

| Type | Mise en scène | Personnes |
|---|---|---|
| **Rotation 360° élégante** | Plateau tournant, fond studio infini, rotation continue qui révèle toutes les faces du produit. | non |
| **Packshot publicitaire net** | Fond neutre impeccable, balayage lumineux, parallaxe subtile. Idéal pour une fiche produit. | non |
| **Macro matière et finitions** | Très gros plans qui glissent sur les matières, coutures et finitions, faible profondeur de champ. | non |
| **Produit en fonctionnement** | Le produit montré en train de fonctionner : mécanisme, écran qui s'allume, bouton. Une main peut intervenir. | oui |
| **Lévitation premium** | Produit flottant dans les airs, rotation lente, particules lumineuses en orbite. | non |
| **Stop-motion / assemblage** | Les pièces s'assemblent une à une pour former le produit complet. Très « scroll-stopping ». | non |
| **Unboxing dramatique** | Ouverture du packaging, gros plans matière, balayage lumineux et révélation en héro shot. | oui |
| **Avant/Après transformation** | Match cut : l'état terne devient désirable au passage d'un balayage lumineux. | non |
| **Mise en situation lifestyle** | Décor inspirant qui vit de lui-même (vapeur, vent, lumière) ; le produit posé, sans personne. | non |
| **Porté en mouvement (mode)** | Une personne porte le produit et marche vers la caméra, le tissu bouge naturellement. | oui |
| **Produit en action / utilisation** | Scène de vie réelle, un adulte utilise le produit naturellement, caméra qui suit le geste. | oui |

La colonne « Personnes » n'est pas indicative : elle se traduit dans le prompt.
Pour les types sans personne, l'instruction interdit explicitement **mains,
visages et silhouettes** — sans quoi les modèles ajoutent volontiers des
présences parasites sur un packshot censé montrer le produit seul.

### Les onze ambiances sonores

| Ambiance | Style décrit au moteur |
|---|---|
| **Corporate professionnel** | Nappe propre, piano chaud, tempo posé. |
| **Énergique et fun** | Pop entraînante, beat marqué, claps. |
| **Luxe et élégant** | Cordes soyeuses, nappe raffinée, tempo lent. |
| **Cinématique épique** | Cordes montantes, impacts profonds, souffle de bande-annonce. |
| **Minimaliste moderne** | Texture épurée, pulsation discrète, esprit design et tech. |
| **Chaleureux et artisanal** | Acoustique, guitare douce, esprit fait main. |
| **Urbain / streetwear** | Beat hip-hop, basse 808, attitude street. |
| **Tendance réseaux sociaux** | Hook accrocheur, rythme serré, pensé pour Reels et TikTok. |
| **Tension dramatique** | Montée de tension puis impact final — parfait avec un unboxing. |
| **Naturel et apaisant** | Souffle d'air, oiseaux lointains, nappe douce. Cosmétique et bien-être. |
| **Pas de son** | Silence total demandé, **et** piste audio supprimée en post-production. |

---

## Choisir un moteur

Le pipeline ne connaît **aucun** moteur en particulier : chaque moteur est un
module de `server/providers/` qui déclare ce qu'il sait faire.

| Capacité | Veo 3.1 | fal.ai | Replicate | Rendu local |
|---|---|---|---|---|
| Animation IA de la photo | ✅ | ✅ | ✅ | ❌ (Ken Burns) |
| **Audio généré par le modèle** | ✅ | ❌ | ❌ | ❌ (nappe locale) |
| **Texte dessiné par le modèle** | ✅ | ❌ | ❌ | ❌ (incrusté) |
| Extension (pour 15 s) | ✅ +7 s | ❌ | ❌ | — |
| Nécessite une clé payante | ✅ oui | ❌ crédits offerts | ❌ crédits offerts | — |
| Coût indicatif | élevé | faible | faible | **nul** |

Ces capacités ne sont pas cosmétiques : elles changent réellement le résultat.
L'application en tient compte automatiquement :

- **moteur sans audio natif** → une **nappe sonore locale** est ajoutée par
  ffmpeg selon l'ambiance choisie (accord synthétisé, fondu entrant/sortant) ;
  « Pas de son » laisse la vidéo muette ;
- **moteur sans rendu de texte** → le mode « Texte généré par Veo » bascule
  automatiquement sur l'incrustation ffmpeg, qui garantit l'orthographe, et
  l'utilisateur en est informé dans le journal ;
- **moteur sans extension** → la durée est plafonnée à ce que le modèle produit
  (le plan l'annonce avant lancement, par exemple « ramenée de 15 s à 5 s »).

### Ajouter un moteur

Créez `server/providers/monmoteur.js` en respectant l'interface, puis
déclarez-le dans `server/providers/index.js` :

```js
export default {
  id: 'monmoteur',
  label: 'Mon moteur',
  keyProvider: 'monmoteur',        // source de clé (voir KEY_SOURCES)
  capabilities: { nativeAudio: false, rendersText: false, extension: false },
  isConfigured() { /* une clé est-elle présente ? */ },
  buildPlan({ durationId, aspectRatio, resolution }) { /* plan de production */ },
  buildConfig(plan) { /* paramètres du modèle */ },
  async generateClip({ imagePath, prompt, plan, outputPath, onProgress }) { /* … */ },
  describeRequest({ plan, prompt }) { /* décrit l'appel SANS l'envoyer */ },
};
```

`describeRequest` n'est pas décoratif : c'est ce qui permet de **vérifier un
adaptateur sans dépenser un centime** (`node scripts/check-providers.mjs`).

---

## Comment la vidéo est produite

```
Photo ─► normalisation ─► prompt ─► MOTEUR image-to-video ─► post-production ─► MP4
           (ffmpeg)                  (plan déclaré par le      (ffmpeg)
                                      moteur, 1 ou 2 appels)
```

1. **Préparation** — la photo est redimensionnée et ré-encodée, ses dimensions
   sont relevées, le cadrage est arrêté.
2. **Plan** — le moteur déclare ce qu'il va réellement produire : nombre
   d'appels, durée de chacun, coupe finale, résolution. C'est ce plan, et non
   une valeur codée en dur, qui pilote tout le reste.
3. **Prompt** — un prompt anglais structuré (la seule langue pleinement évaluée)
   assemble : la scène du type de vidéo, un bloc de **fidélité produit**
   (« conserve forme, couleur, matière, logo, étiquettes »), le mouvement, les
   consignes de texte, l'ambiance sonore — uniquement si le moteur gère l'audio
   — et les contraintes techniques issues du plan.
4. **Génération** — appel du moteur, suivi de l'opération longue durée, puis
   téléchargement du MP4 (les services ne conservent pas les fichiers
   indéfiniment : Veo les supprime au bout de 2 jours).
5. **Étapes supplémentaires** — prolongation, si le plan en prévoit.
6. **Post-production** — nappe sonore locale si le moteur n'en produit pas,
   coupe à la seconde exacte, suppression de l'audio si « Pas de son »,
   incrustation du texte, extraction du poster, écriture des métadonnées.

L'avancement est diffusé en **Server-Sent Events** ; la production continue même
si vous fermez l'onglet.

---

## Durées : la correspondance avec chaque moteur

Les durées demandées sont **5, 8 ou 15 secondes**, mais aucun moteur ne les
accepte telles quelles. Chaque fournisseur traduit donc la demande en plan de
production réel, et **annonce ce qu'il livrera** avant de lancer :

| Demandé | Veo 3.1 | fal.ai / Replicate |
|---|---|---|
| **5 s** | Veo génère **6 s**, puis ffmpeg coupe précisément à **5,00 s**. | Wan produit **5,06 s** (81 images à 16 i/s), coupées à **5,00 s**. |
| **8 s** | Durée native : **8 s**. | **Limité à 6,25 s** (100 images = plafond du modèle), annoncé comme tel. |
| **15 s** | 8 s **+ extension de 7 s** = **exactement 15 s** (2 appels). | **Limité à 6,25 s**, annoncé comme tel. |

Contraintes Veo appliquées automatiquement :

- l'extension impose **8 s, du 720p et un ratio 16:9 ou 9:16** ;
- le **1080p n'est disponible que pour des clips de 8 s** — ailleurs, la
  définition est ramenée à 720p ;
- l'image-to-video exige `personGeneration: "allow_adult"` ;
- seuls les paramètres documentés comme supportés par l'API Gemini sont
  transmis (`generateAudio` et `lastFrame` n'y sont **pas** supportés pour
  Veo 3.x — les envoyer provoquerait une erreur).

Pour fal.ai et Replicate, la durée d'un clip et l'identifiant du modèle sont
**propres au modèle choisi** : réglez `FAL_CLIP_SECONDS` / `REPLICATE_CLIP_SECONDS`
et l'identifiant du modèle dans `.env` d'après sa fiche.

---

## Texte promotionnel intégré

Veo sait dessiner du texte, mais l'orthographe d'une accroche commerciale n'est
jamais garantie. L'application propose donc trois stratégies (option avancée
« Texte promotionnel ») :

| Mode | Comportement |
|---|---|
| **Incrustation nette** *(par défaut, recommandé)* | Veo filme un cadre propre avec de l'espace libre dans le tiers inférieur, et ffmpeg incruste le **texte exact** avec une typographie maîtrisée : bandeau doré pour le nom du produit en haut, message en gras sur fond semi-transparent centré à 70 % de la hauteur, apparition et disparition en fondu. Orthographe garantie, rendu identique à chaque fois. |
| **Texte généré par Veo** | Le texte est décrit dans le prompt et Veo le dessine lui-même dans l'image. Plus « fondu » dans la scène, mais l'orthographe n'est pas garantie. |
| **Aucun texte** | Vidéo produit pure, sans message. |

L'aperçu affiché dans l'interface **reproduit exactement la géométrie de
l'incrustation** (mêmes proportions de corps et de position) : ce que vous voyez
avant de lancer la production est ce qui est écrit dans la vidéo.

---

## Audio et « Pas de son »

Veo 3.x **génère toujours de l'audio** ; il n'existe pas de paramètre pour le
désactiver. L'ambiance se pilote donc par le prompt, et l'option « Pas de son »
est garantie par la post-production :

| Ambiance | Prompt envoyé au moteur (si audio natif) | Post-production |
|---|---|---|
| Les 10 ambiances sonores | Décrit au moteur : style, instrumentation, tempo. | — |
| **Pas de son** | Silence total demandé dans le prompt. | **Piste audio supprimée** (`-an`) : la vidéo est réellement muette, quoi que produise le moteur. |

Chaque prompt précise « instrumental seulement : ni dialogue, ni voix off, ni
paroles ».

**Avec un moteur sans audio natif** (fal.ai, Replicate), le bloc audio est
retiré du prompt — décrire une musique à un modèle qui ne sait pas en produire
serait inutile — et une **nappe sonore locale** est synthétisée par ffmpeg selon
l'ambiance choisie : un accord dont le timbre et la pulsation varient (posé pour
le corporate, marqué pour l'énergique, lent et aigu pour le luxe), avec fondu
entrant et sortant. C'est un accompagnement, pas une musique produite : pour un
rendu final haut de gamme, remplacez la piste par votre propre musique dans un
outil de montage.

---

## Suggestions de messages

Le bouton **« Proposer des messages »** demande 5 accroches publicitaires à
`gemini-2.5-flash`, en s'appuyant sur le nom du produit, le type de vidéo et
l'ambiance. Les contraintes imposées au modèle : 45 caractères maximum (pour
tenir à l'écran), pas d'emoji, pas de superlatif mensonger.

C'est une aide **gratuite** : le palier gratuit de Gemini couvre les modèles
texte, même lorsqu'il refuse Veo. Si aucune clé Gemini n'est présente — ou si le
quota texte est atteint — le serveur renvoie un **repli local** de cinq accroches
construites hors ligne : l'interface propose toujours quelque chose.

---

## Mode démo (sans clé API)

Sans aucune clé — ou avec `DEMO=1`, ou en choisissant « Rendu local » dans les
options avancées — l'application reste **entièrement utilisable et testable** :
la photo est animée localement par un effet Ken Burns (`zoompan`), l'habillage
texte est **exactement le même** que pour une vidéo générée, et une nappe sonore
est synthétisée par ffmpeg selon l'ambiance choisie. L'option « Pas de son »
produit là aussi une vidéo réellement muette.

Cela permet de valider le cadrage, le texte et le montage sans dépenser le
moindre crédit. L'interface signale clairement ce mode.

Ce mode sert aussi de **repli immédiat** : si un appel est refusé (quota, accès,
filtre de sécurité), la zone d'erreur propose « **Relancer en mode démo local** »,
qui reproduit la vidéo à partir de la même photo et des mêmes réglages, sans
nouvel appel distant. Vous n'êtes jamais laissé sans résultat.

---

## Coûts et temps de production

- **1 appel Veo facturé** pour 5 s et 8 s, **2 appels** pour 15 s (génération +
  extension). Chaque nouvel essai est un nouvel appel facturé — l'interface
  indique le nombre d'appels avant de lancer.
- Les vidéos bloquées par les filtres de sécurité **ne sont pas facturées**.
- Latence Veo annoncée : **11 secondes minimum, jusqu'à 6 minutes** en heure de
  pointe ; comptez donc **1 à 4 min** pour un plan, **2 à 8 min** pour 15 s.
- Les tarifs Veo évoluent : consultez la
  [grille tarifaire Gemini](https://ai.google.dev/gemini-api/docs/pricing#veo-3.1).
  Le modèle *Veo 3.1 Fast* est l'option économique.

---

## Configuration

Toutes les variables sont optionnelles sauf les clés (voir `.env.example`) :

| Variable | Défaut | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | Clé Google AI Studio (Veo + suggestions de messages). |
| `FAL_KEY` | — | Clé fal.ai. |
| `REPLICATE_API_TOKEN` | — | Jeton Replicate. |
| `FAL_MODEL` | `fal-ai/wan-i2v` | Endpoint fal utilisé (doit être un modèle image-to-video). |
| `FAL_FRAMES_PER_SECOND` | `16` | Cadence du clip fal (5 à 24 i/s selon le modèle). |
| `FAL_NUM_FRAMES` | `81` | Nombre d'images (81 à 100 selon le modèle). 81 à 16 i/s ≈ 5,06 s ; 100 = 6,25 s. |
| `REPLICATE_MODEL` | `wan-video/wan-2.2-i2v-fast` | Modèle Replicate (« owner/nom » ou « owner/nom:hash »). |
| `REPLICATE_CLIP_SECONDS` | `5` | Durée d'un clip produite par ce modèle. |
| `PROVIDER` | — | Force un moteur (`veo`, `fal`, `replicate`) même si plusieurs clés existent. |
| `PORT` | `5178` | Port d'écoute. |
| `HOST` | `127.0.0.1` | Interface d'écoute (boucle locale par défaut). |
| `DEMO` | — | `1` force le rendu local, même avec des clés. |
| `FFMPEG_PATH` | paquet npm | Chemin vers un ffmpeg spécifique. |

---

## API HTTP

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/health` | État du serveur, moteurs disponibles et clés configurées. |
| `GET` | `/api/options` | Catalogues des listes déroulantes (source unique de vérité). |
| `GET` | `/api/plan?duration=&provider=&aspectRatio=&resolution=` | Plan réel annoncé par le moteur retenu. `provider=demo` force le rendu local. |
| `POST` | `/api/jobs` | Crée une production (`multipart/form-data`). |
| `GET` | `/api/jobs/:id` | État d'une production. |
| `GET` | `/api/jobs/:id/events` | Avancement en **SSE**. |
| `GET` | `/api/jobs/:id/video` | Vidéo finale (`?download=1` pour forcer le téléchargement). |
| `GET` | `/api/jobs/:id/poster` | Image de poster. |
| `GET` | `/api/jobs/:id/source` | Photo source (aperçu). |
| `GET` | `/api/jobs/:id/meta` | Métadonnées (réglages, plan, prompt utilisé). |
| `POST` | `/api/jobs/:id/retry` | Relance avec les mêmes réglages. Corps `{"mode":"demo"}` pour forcer un rendu local. |
| `POST` | `/api/suggest-messages` | 5 accroches publicitaires (`{productName, videoTypeId, ambianceId}`). |
| `POST` | `/api/settings/api-key` | Enregistre une clé (`{key, value}` ; `key` = `gemini`, `fal` ou `replicate`). |
| `POST` | `/api/settings/api-key/clear` | Retire une clé (`{key}`). |
| `POST` | `/api/settings/api-key/test` | Teste une clé sans l'enregistrer. |
| `GET` | `/api/diagnostics` | Vérifie que ffmpeg est opérationnel. |

Exemple :

```bash
curl -X POST http://127.0.0.1:5178/api/jobs \
  -F photo=@sneakers.jpg \
  -F productName="Sneakers Aero Runner" \
  -F adMessage="Nouveau ! -30% cette semaine" \
  -F videoTypeId=rotation360 \
  -F ambianceId=luxe \
  -F durationId=8 \
  -F providerId=veo
```

---

## Tests

Le serveur doit tourner (`npm start`) dans un autre terminal.

```bash
npm test                                        # bout en bout, en rendu local
node scripts/smoke-test.mjs --duration 5
node scripts/smoke-test.mjs --duration 15 --ambiance aucun
node scripts/smoke-test.mjs --duration 5 --vertical --ambiance luxe --videoType beforeAfter
node scripts/smoke-test.mjs --veo               # vrai appel Veo (payant, consomme du quota)

node scripts/check-providers.mjs                # vérifie les 3 adaptateurs SANS clé
node scripts/check-provider-schema.mjs          # confronte nos requêtes au schéma officiel fal
node scripts/check-catalog.mjs                  # vérifie les 11 types × 11 ambiances
node scripts/check-ui-hidden.mjs                # conflits entre l'attribut hidden et le CSS
node scripts/probe-key.mjs                      # ce que votre clé Gemini peut réellement appeler
```

`npm test` enchaîne le test de bout en bout **puis** le contrôle des conflits
`hidden`/CSS. Les autres scripts s'appellent séparément :

```bash
npm run test:catalog      # 11 types × 11 ambiances
npm run test:providers    # adaptateurs + schéma officiel fal
```

**`npm test`** (bout en bout) :

1. fabrique une **photo produit synthétique** avec ffmpeg ;
2. envoie le formulaire complet en **forçant le rendu local** ;
3. suit la production réelle ;
4. télécharge la vidéo et vérifie **durée, définition, présence ou absence de
   piste audio**, disponibilité du poster, et **lecture partielle HTTP 206**
   (indispensable pour que le lecteur puisse se déplacer dans la timeline) ;
5. vérifie la **cohérence des identifiants DOM** entre `index.html` et `app.js` ;
6. vérifie que les **catalogues** contiennent toujours les entrées exigées par le
   cahier des charges (rotation 360°, action, unboxing, avant/après ; corporate,
   énergique, luxe, pas de son ; 5/8/15 s), sans figer leur nombre — le
   catalogue est destiné à s'enrichir, mais rien d'exigé ne doit disparaître ;
7. fabrique un clip muet et contrôle l'ajout de la **nappe sonore locale**
   (chemin utilisé par fal.ai et Replicate, qu'on ne peut pas tester sans clé).

Il est **gratuit et déterministe** : il n'appelle jamais de moteur distant, même
quand des clés sont configurées.

**`check-catalog.mjs`** construit le prompt réel des **11 types × 11 ambiances**
et vérifie qu'il est cohérent : fidélité produit présente, contrainte de
présence humaine respectée (interdiction explicite des mains et silhouettes pour
les types « produit seul »), et bloc audio présent ou retiré selon que le moteur
sait produire du son. Il affiche aussi un prompt complet, pour contrôle visuel.

**`check-providers.mjs`** est le test le plus utile quand on ajoute un moteur :
il calcule les plans pour 5, 8 et 15 s, puis affiche la **requête exacte qui
serait envoyée** (URL, en-têtes, corps) sans l'envoyer. C'est ainsi qu'un
adaptateur se valide **sans clé et sans dépenser un centime**.

**`check-provider-schema.mjs`** va plus loin : il récupère le **schéma OpenAPI
publié par fal** pour l'endpoint configuré et confronte notre requête à la
réalité du modèle. C'est ce contrôle qui a révélé que le paramètre `duration`
n'existe pas chez fal (la durée se pilote par `num_frames` et
`frames_per_second`) et que son `resolution` n'accepte que `480p` ou `720p` —
deux erreurs qui auraient fait échouer le premier appel réel en 422. À lancer
après tout changement de `FAL_MODEL`.

---

## Architecture

```
server/
  index.js        serveur HTTP, upload, validation, routes SSE
  config.js       source unique de vérité : catalogues, bornes, clés API
  prompts.js      construction des prompts à partir du plan du moteur
  pipeline.js     orchestration d'une production complète
  jobs.js         suivi des tâches + diffusion SSE
  ffmpeg.js       post-production : coupe, audio, habillage, rendu local
  suggest.js      accroches publicitaires (modèle texte, gratuit)
  providers/
    index.js      registre et sélection du moteur
    http.js       outils partagés : polling, téléchargement, erreurs
    veo.js        Veo 3.1 (API Gemini)  — audio natif, extension
    fal.js        fal.ai (file d'attente queue.fal.run)
    replicate.js  Replicate (api.replicate.com)
public/
  index.html      structure de l'interface
  styles.css      thème studio sombre
  app.js          logique client, aperçu fidèle de l'habillage
scripts/
  smoke-test.mjs             test de bout en bout (gratuit)
  check-providers.mjs        vérifie les adaptateurs sans clé
  check-provider-schema.mjs  confronte nos requêtes au schéma officiel fal
  check-catalog.mjs          vérifie les 11 types × 11 ambiances
  check-ui-hidden.mjs        conflits attribut hidden / CSS
  probe-key.mjs              ce que la clé Gemini peut réellement appeler
```

---

## Dépannage

| Symptôme | Cause probable et solution |
|---|---|
| Le bandeau indique « Mode démo local » | Aucune clé de moteur configurée. Cliquez sur « Réglages » et ajoutez une clé, ou choisissez « Rendu local » volontairement. |
| « Clé API refusée par Google » / par le service | Clé erronée ou expirée : régénérez-la chez le fournisseur. |
| **« Veo a refusé la requête : quota ou accès indisponible (429) »** | Cause la plus fréquente : **le projet Google n'est pas sur un palier payant**. Veo est un modèle *preview* qui exige un compte de facturation actif (palier **Tier 1** : « link an active billing account »). Vérifiez vos limites réelles sur <https://aistudio.google.com/rate-limit> : **si Veo y affiche 0, il faut activer la facturation**. Le message « check your plan and billing details » désigne le palier, pas une panne. Lancez `node scripts/probe-key.mjs` pour confirmer. |
| Bloqué par ce 429 et vous voulez avancer tout de suite | Deux solutions : cliquez sur **« Relancer en mode démo local »**, ou **ajoutez une clé fal.ai / Replicate** (crédits offerts) et choisissez ce moteur dans les options avancées. |
| La vidéo ne s'affiche pas après une production réussie | Bug corrigé : une règle CSS d'auteur (`display: flex`) écrasait le `[hidden]` du navigateur, si bien que le message « Votre vidéo apparaîtra ici » **recouvrait** la vidéo pourtant générée. Un garde-fou global `[hidden] { display: none !important }` est en place, et `npm test` vérifie ce conflit. Si vous voyez encore ce symptôme, forcez le rechargement de la page (Ctrl+F5). |
| Le champ « Modèle Veo » reste affiché avec un autre moteur | Bug corrigé (même cause que ci-dessus). |
| « Crédits épuisés chez le fournisseur (la clé est valide) » | Votre compte fal.ai / Replicate n'a plus de solde. fal renvoie alors un 401 avec « Exhausted balance », ce qui ressemble à une clé invalide : ce n'est pas le cas. Rechargez le compte, changez de moteur, ou lancez un rendu local. |
| La vidéo ne fait que 6,25 s alors que j'ai demandé 15 s | Le modèle fal `wan-i2v` est plafonné à 100 images, soit 6,25 s : c'est annoncé dans le plan avant lancement. Utilisez Veo (extension +7 s) pour atteindre exactement 15 s. |
| Le texte n'est pas celui que j'ai écrit | Vous utilisez « Texte généré par Veo » : la restitution du texte par le modèle n'est pas garantie. Choisissez « Incrustation nette », où ffmpeg écrit le texte exact. |
| La musique ne correspond pas à une vraie bande son | Avec fal.ai / Replicate, aucune IA ne produit l'audio : c'est une nappe locale de ffmpeg. Utilisez Veo (audio natif) ou remplacez la piste en montage. |
| « Veo n'est pas disponible pour ce projet » | Facturation absente sur le projet Google, ou région non desservie. |
| « La génération a été bloquée par les filtres de sécurité » | Photo ou message refusé (allégations santé, marque tierce, personne identifiable). Changez la photo ou reformulez le message. |
| « Veo n'a renvoyé aucune vidéo » | Fréquent quand l'**audio** est bloqué par les filtres. Relancez la génération. |
| « ffmpeg est introuvable » | `npm install` incomplet, ou définissez `FFMPEG_PATH`. Vérifiez avec `GET /api/diagnostics`. |
| La vidéo de 5 s fait 5,04 s | Normal : la coupe est précise à l'image près (1/30 s). |
| Production très lente | Veo peut dépasser 6 minutes aux heures de pointe, et 15 s enchaîne deux générations. |
| `parameter not supported` chez fal / Replicate | Les noms de paramètres varient d'un modèle à l'autre. Lancez `node scripts/check-providers.mjs` pour voir le corps exact envoyé, puis ajustez `FAL_MODEL` / `REPLICATE_MODEL` et les entrées dans le provider. |

---

## Limites connues

- **Veo 3.1 est un modèle en aperçu** : disponibilité, quotas et tarifs peuvent
  évoluer. Il exige une facturation active côté Google.
- Les vidéos Veo sont **supprimées au bout de 2 jours** côté Google — le
  téléchargement local est donc effectué immédiatement. Les fichiers produits
  restent, eux, dans `outputs/`.
- L'**extension vidéo n'est possible que sur des vidéos générées par Veo**, en
  8 s et 720p — c'est la raison des contraintes appliquées à l'option 15 s.
- **L'adaptateur fal.ai est vérifié contre le schéma officiel du modèle**
  (`check-provider-schema.mjs`) : champs envoyés, champs requis, énumérations et
  bornes de durée. En revanche, **il n'a pas encore été exécuté avec une vraie
  clé** : le tout premier appel réel reste à confirmer.
- **L'adaptateur Replicate n'a pas pu être vérifié du tout** : son schéma exige
  un jeton (`GET https://api.replicate.com/v1/models/<owner>/<nom>`), que je n'ai
  pas. Il envoie volontairement un corps minimal (`prompt` + `image`) pour
  limiter le risque de champ refusé ; si un modèle réclame d'autres entrées,
  ajoutez-les dans `server/providers/replicate.js`.
- Les modèles fal/Replicate ne produisent **ni audio ni texte** : la bande son
  est une nappe locale et le texte est incrusté par ffmpeg.
- Chaque vidéo Veo porte un **filigrane invisible SynthID**.
- En mode « Texte généré par Veo », l'orthographe du texte affiché n'est pas
  garantie : préférez l'incrustation (mode par défaut) pour une accroche
  commerciale.
- Le suivi des tâches est **en mémoire** : redémarrer le serveur perd l'historique
  (mais pas les fichiers produits, déjà écrits sur disque).
