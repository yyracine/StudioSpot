# Animateur de Photos Produit

Transformez **une photo de produit statique** en **vidéo publicitaire animée** :
l'application construit le prompt, appelle un **moteur image-to-video** (fal.ai ou
Replicate), puis assure toute la post-production — texte promotionnel intégré,
coupe à la seconde exacte, ambiance sonore ou silence total.

Conçue pour le e-commerce et le marketing : vêtements, objets, tech.

> **Reprise du projet ?** Lisez [`RESUME.md`](RESUME.md) : état exact du dépôt,
> contraintes techniques de la machine, bugs déjà corrigés et limites non
> vérifiées. C'est le document de passation.

---

## Sommaire

- [Ce que fait l'application](#ce-que-fait-lapplication)
- [Démarrage rapide](#démarrage-rapide)
- [Vos clés API](#vos-clés-api)
- [Les champs du formulaire](#les-champs-du-formulaire)
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
4. **Type de vidéo** — 11 mises en scène.
5. **Ambiance sonore** — 11 choix, dont « Pas de son ».
6. **Durée** — 5 s, 8 s ou 15 s.
7. **Bouton « Animer mon produit »** — lance la production et suit son
   avancement en temps réel.

Le résultat : une vidéo MP4 avec **animation du produit**, **texte promotionnel
intégré** et **audio conforme à l'ambiance choisie**, téléchargeable en un clic.

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

---

## Vos clés API

**Aucun fournisseur à choisir** : cliquez sur **« Réglages »**, collez la clé
API que vous voulez, et l'application la reconnaît à sa forme.

| Format reconnu | Fournisseur | Rôle |
|---|---|---|
| `r8_…` | **Replicate** | Génération vidéo |
| `xxxxxxxx-…:…` (identifiant:secret) | **fal.ai** | Génération vidéo |
| `AIza…` ou `AQ.…` | **Google AI Studio** | Suggestions de messages (texte) uniquement |

Une clé non reconnue est refusée **avec la liste des formes acceptées** — rien
n'est deviné au hasard. Les clés sont conservées **côté serveur** (fichier
`.env`) et ne sont jamais renvoyées au navigateur. Vous pouvez aussi les placer
directement dans `.env` :

```bash
cp .env.example .env
# puis renseignez FAL_KEY=… ou REPLICATE_API_TOKEN=… (et GEMINI_API_KEY=… si
# vous voulez des suggestions de messages générées par le modèle)
```

Le serveur n'écoute que sur `127.0.0.1` par défaut : ni les photos, ni les
vidéos, ni les clés ne sortent de la machine.

> **Diagnostic** : `node scripts/probe-key.mjs` indique ce que votre clé Google
> peut réellement appeler. La génération vidéo dépend d'un fournisseur dédié.

---

## Les champs du formulaire

| Champ | Rôle |
|---|---|
| **Photo du produit** | Image source de l'animation. JPEG, PNG ou WebP, 25 Mo max. Elle est normalisée (redimensionnée à 1920 px max, ré-encodée en JPEG) avant l'envoi au moteur. Le cadrage (16:9 ou 9:16) est déduit de ses dimensions, sauf choix manuel — une photo **carrée** donne du 9:16. |
| **Nom du produit** | Repris **mot pour mot** dans le prompt pour que le moteur préserve le produit, et affiché en bandeau haut dans la vidéo (60 caractères max). |
| **Message publicitaire** | Le texte promotionnel incrusté dans la vidéo (120 caractères max). Découpé automatiquement en lignes courtes pour rester lisible. Un bouton propose 5 accroches générées. |
| **Type de vidéo** | Détermine la mise en scène, le mouvement et le rythme (11 choix). |
| **Ambiance sonore** | Détermine la musique décrite au moteur, et si nécessaire la synthèse locale de l'audio (11 choix). |
| **Durée** | 5, 8 ou 15 secondes — traduite en plan de production réel selon le moteur. |

**Options avancées** : moteur de génération, cadrage (auto / 16:9 / 9:16),
définition (720p / 1080p), modèle utilisé (information), et mode de rendu du
texte.

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
| **Pas de son** | Aucun son : piste audio supprimée en post-production. |

---

## Choisir un moteur

Le pipeline ne connaît **aucun** moteur en particulier : chaque moteur est un
module de `server/providers/` qui déclare ce qu'il sait faire.

| Capacité | fal.ai | Replicate | Rendu local |
|---|---|---|---|
| Animation IA de la photo | ✅ | ✅ | ❌ (Ken Burns) |
| **Audio généré par le modèle** | ❌ | ❌ | ❌ (nappe locale) |
| **Texte dessiné par le modèle** | ❌ | ❌ | ❌ (incrusté) |
| Extension (pour 15 s) | ❌ | ❌ | — |
| Clé requise | oui (crédits) | oui (crédits) | — |
| Coût indicatif | faible | faible | **nul** |

Ces capacités ne sont pas cosmétiques : elles changent réellement le résultat.
L'application en tient compte automatiquement :

- **moteur sans audio natif** → une **nappe sonore locale** est ajoutée par
  ffmpeg selon l'ambiance choisie (accord synthétisé, fondu entrant/sortant) ;
  « Pas de son » laisse la vidéo muette ;
- **moteur sans rendu de texte** → le mode « Texte généré par le modèle »
  bascule automatiquement sur l'incrustation ffmpeg, qui garantit l'orthographe,
  et l'utilisateur en est informé dans le journal ;
- **moteur sans extension** → la durée est plafonnée à ce que le modèle produit
  (le plan l'annonce avant lancement, par exemple « ramenée de 15 s à 6,25 s »).

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
3. **Prompt** — un prompt anglais structuré assemble : la scène du type de
   vidéo, un bloc de **fidélité produit** (« conserve forme, couleur, matière,
   logo, étiquettes »), la contrainte de présence humaine, le mouvement, les
   consignes de texte, l'ambiance sonore — uniquement si le moteur gère l'audio
   — et les contraintes techniques issues du plan.
4. **Génération** — appel du moteur, suivi de l'opération longue durée, puis
   téléchargement du MP4.
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

| Demandé | fal.ai (`wan-i2v`) | Replicate |
|---|---|---|
| **5 s** | 81 images à 16 i/s = **5,06 s**, coupées à **5,00 s**. | Clip de 5 s. |
| **8 s** | **Limité à 6,25 s** (100 images = plafond du modèle), annoncé comme tel. | **Limité à 5 s**, annoncé. |
| **15 s** | **Limité à 6,25 s**, annoncé comme tel. | **Limité à 5 s**, annoncé. |

Aucun fournisseur actuellement intégré ne sait **prolonger** un clip : 15 s n'est
donc jamais atteignable en une passe. Le plan l'indique clairement avant la
génération, plutôt que de laisser croire à une promesse intenable.

Pour fal.ai, la durée d'un clip et l'identifiant du modèle sont **propres au
modèle choisi** : réglez `FAL_FRAMES_PER_SECOND`, `FAL_NUM_FRAMES` et
`FAL_MODEL` dans `.env` d'après sa fiche, puis vérifiez avec
`node scripts/check-provider-schema.mjs`.

---

## Texte promotionnel intégré

Aucun des moteurs intégrés ne dessine de texte de façon fiable. L'application
propose donc trois stratégies (option avancée « Texte promotionnel ») :

| Mode | Comportement |
|---|---|
| **Incrustation nette** *(par défaut, recommandé)* | Le moteur filme un cadre propre avec de l'espace libre dans le tiers inférieur, et ffmpeg incruste le **texte exact** avec une typographie maîtrisée : bandeau doré pour le nom du produit en haut, message en gras sur fond semi-transparent centré à 70 % de la hauteur, apparition et disparition en fondu. Orthographe garantie, rendu identique à chaque fois. |
| **Texte généré par le modèle** | Le texte est décrit dans le prompt et le moteur le dessine lui-même. **Nécessite un moteur capable de rendre du texte** : aucun de ceux intégrés aujourd'hui ne l'est, donc l'application bascule sur l'incrustation et le signale dans le journal. |
| **Aucun texte** | Vidéo produit pure, sans message. |

L'aperçu affiché dans l'interface **reproduit exactement la géométrie de
l'incrustation** (mêmes proportions de corps et de position) : ce que vous voyez
avant de lancer la production est ce qui est écrit dans la vidéo.

---

## Audio et « Pas de son »

Les moteurs intégrés (fal.ai, Replicate) **ne génèrent pas d'audio**. L'ambiance
choisie est donc produite localement :

| Ambiance | Effet local |
|---|---|
| Les 10 ambiances sonores | Une **nappe synthétisée** par ffmpeg : accord dont le timbre, la hauteur et la pulsation varient (posé pour le corporate, marqué pour l'énergique, grave pour l'urbain, lent et aigu pour le luxe), avec fondu entrant et sortant. |
| **Pas de son** | Aucune piste audio : la vidéo est réellement muette. |

C'est un **accompagnement**, pas une reproduction fidèle du style décrit :
« Urbain / streetwear » ne sonnera pas comme du hip-hop. Pour un rendu final haut
de gamme, remplacez la piste par votre propre musique dans un outil de montage —
l'habillage texte, lui, est définitif.

---

## Mode démo (sans clé API)

Sans aucune clé — ou avec `DEMO=1`, ou en choisissant « Rendu local » dans les
options avancées — l'application reste **entièrement utilisable et testable** :
la photo est animée localement par un effet Ken Burns (`zoompan`), l'habillage
texte est **exactement le même** que pour une vidéo générée, et une nappe
sonore est synthétisée par ffmpeg selon l'ambiance choisie. L'option « Pas de
son » produit là aussi une vidéo réellement muette.

Cela permet de valider le cadrage, le texte et le montage sans dépenser le
moindre crédit. L'interface signale clairement ce mode.

Ce mode sert aussi de **repli immédiat** : si un appel est refusé (crédits
épuisés, erreur du fournisseur, filtre de sécurité), la zone d'erreur propose
« **Relancer en mode démo local** », qui reproduit la vidéo à partir de la même
photo et des mêmes réglages, sans nouvel appel distant. Vous n'êtes jamais
laissé sans résultat.

---

## Suggestions de messages

Le bouton **« Proposer des messages »** demande 5 accroches publicitaires à
`gemini-2.5-flash`, en s'appuyant sur le nom du produit, le type de vidéo et
l'ambiance. Les contraintes imposées au modèle : 45 caractères maximum (pour
tenir à l'écran), pas d'emoji, pas de superlatif mensonger.

Cette aide est **purement textuelle** : elle n'utilise aucune clé de génération
vidéo. Sans clé Google — ou si le quota texte est atteint — le serveur renvoie
un **repli local** de cinq accroches construites hors ligne, adaptées au type de
vidéo choisi : l'interface propose toujours quelque chose.

---

## Coûts et temps de production

- Chaque génération est facturée par le fournisseur, à la seconde ou à l'unité
  selon le modèle. Chaque nouvel essai est un nouvel appel facturé — l'interface
  indique le nombre d'appels avant de lancer.
- Latence typique : **quelques dizaines de secondes à plusieurs minutes** selon
  le modèle et la charge. Le suivi en direct affiche le temps écoulé.
- Tarifs : consultez les pages de [fal.ai](https://fal.ai/pricing) et de
  [Replicate](https://replicate.com/pricing). Un clip court coûte généralement
  quelques centimes.

---

## Configuration

Toutes les variables sont optionnelles sauf les clés (voir `.env.example`) :

| Variable | Défaut | Description |
|---|---|---|
| `FAL_KEY` | — | Clé fal.ai (génération vidéo). |
| `FAL_MODEL` | `fal-ai/wan-i2v` | Endpoint fal utilisé (doit être un modèle image-to-video). |
| `FAL_FRAMES_PER_SECOND` | `16` | Cadence du clip fal (5 à 24 i/s selon le modèle). |
| `FAL_NUM_FRAMES` | `81` | Nombre d'images (81 à 100 selon le modèle). 81 à 16 i/s ≈ 5,06 s ; 100 = 6,25 s. |
| `REPLICATE_API_TOKEN` | — | Jeton Replicate (génération vidéo). |
| `REPLICATE_MODEL` | `wan-video/wan-2.2-i2v-fast` | Modèle Replicate (« owner/nom » ou « owner/nom:hash »). |
| `REPLICATE_CLIP_SECONDS` | `5` | Durée d'un clip produite par ce modèle. |
| `GEMINI_API_KEY` | — | Clé Google AI Studio, **uniquement** pour les suggestions de messages. |
| `PROVIDER` | — | Force un moteur (`fal`, `replicate`) même si plusieurs clés existent. |
| `PORT` | `5178` | Port d'écoute. |
| `HOST` | `127.0.0.1` | Interface d'écoute (boucle locale par défaut). |
| `DEMO` | — | `1` force le rendu local, même avec des clés. |
| `FFMPEG_PATH` | paquet npm | Chemin vers un ffmpeg spécifique. |

---

## API HTTP

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/health` | État du serveur, moteurs disponibles et clés configurées. |
| `GET` | `/api/options` | Catalogues des listes déroulantes + formats de clés acceptés. |
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
| `POST` | `/api/settings/key` | Enregistre la clé collée (`{value}`) : le fournisseur est reconnu automatiquement. |
| `POST` | `/api/settings/key/clear` | Retire une clé (`{source}`). |
| `POST` | `/api/settings/key/test` | Teste une clé sans l'enregistrer (`{value}`). |
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
  -F providerId=fal
```

---

## Tests

Le serveur doit tourner (`npm start`) dans un autre terminal.

```bash
npm test                    # bout en bout (gratuit) + conflits hidden/CSS
npm run test:catalog        # 11 types × 11 ambiances
npm run test:providers      # adaptateurs + schéma officiel fal
npm run test:keys           # reconnaissance des clés API

node scripts/smoke-test.mjs --duration 15 --ambiance aucun
node scripts/smoke-test.mjs --vertical --duration 5
node scripts/smoke-test.mjs --engine          # vrai appel à un moteur (payant)

node scripts/probe-key.mjs                    # diagnostic de clé Google
node scripts/check-provider-schema.mjs        # nos requêtes vs schéma fal officiel
node scripts/check-ui-hidden.mjs              # conflits hidden / CSS
```

**`npm test`** (bout en bout) vérifie : durée réelle de la vidéo, définition,
présence ou absence de piste audio, disponibilité du poster, **lecture partielle
HTTP 206** (indispensable à la timeline), cohérence des identifiants DOM,
présence des entrées exigées dans les catalogues, et l'ajout de la **nappe
sonore locale**. Il est **gratuit et déterministe** : il force le rendu local et
n'appelle aucun moteur distant.

**`check-provider-schema.mjs`** récupère le **schéma OpenAPI publié par fal** et
confronte notre requête à la réalité du modèle : champs inconnus, champs requis,
valeurs hors énumération, bornes de durée. C'est ce contrôle qui a révélé que le
paramètre `duration` n'existe pas chez fal (la durée se pilote par `num_frames`
et `frames_per_second`) et que son `resolution` n'accepte que `480p` ou `720p`.

**`check-api-keys.mjs`** exerce la reconnaissance des clés. ⚠️ Attention : il
écrit de vraies clés factices et l'enregistrement persiste dans `.env` — le
script **sauvegarde puis restaure** ce fichier. Ne retirez pas cette protection.

---

## Architecture

```
server/
  index.js        serveur HTTP, upload, validation, routes SSE
  config.js       source unique de vérité : catalogues, bornes, clés
  api-keys.js     reconnaissance d'une clé par sa forme
  prompts.js      construction des prompts à partir du plan du moteur
  pipeline.js     orchestration d'une production complète
  jobs.js         suivi des tâches + diffusion SSE
  ffmpeg.js       post-production : coupe, audio, habillage, rendu local
  suggest.js      accroches publicitaires (modèle texte, gratuit)
  providers/
    index.js      registre et sélection du moteur
    http.js       outils partagés : polling, téléchargement, erreurs
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
  check-api-keys.mjs         reconnaissance des clés API
  probe-key.mjs              ce que la clé Google peut réellement appeler
```

---

## Dépannage

| Symptôme | Cause probable et solution |
|---|---|
| Le bandeau indique « Mode démo local » | Aucune clé de moteur configurée. Ouvrez « Réglages » et collez une clé, ou choisissez « Rendu local » volontairement. |
| « Format de clé non reconnu » | La clé ne correspond à aucune forme connue : `r8_…` (Replicate), `identifiant:secret` (fal), `AIza…`/`AQ.…` (Google). Vérifiez que vous n'avez pas collé autre chose (identifiant de compte, mot de passe). |
| « Crédits épuisés chez le fournisseur (la clé est valide) » | Votre compte fal.ai / Replicate n'a plus de solde. fal renvoie alors un 401 avec « Exhausted balance », ce qui ressemble à une clé invalide : ce n'est pas le cas. Rechargez le compte, changez de moteur, ou lancez un rendu local. |
| « Accès refusé par le service (clé ou droits) » | Clé invalide, expirée, ou compte non autorisé sur ce modèle. |
| « Le fournisseur limite le débit (429) » | Attendez une minute, ou réduisez la cadence des générations. |
| « Modèle introuvable chez le fournisseur (404) » | L'identifiant du modèle configuré n'existe pas ou plus. Corrigez `FAL_MODEL` / `REPLICATE_MODEL`, puis vérifiez avec `node scripts/check-provider-schema.mjs`. |
| « Le fournisseur a refusé les paramètres envoyés (422) » | Un champ envoyé n'existe pas pour ce modèle. Lancez `check-provider-schema.mjs` : il confronte notre requête au schéma officiel. |
| La vidéo ne fait que 6,25 s alors que j'ai demandé 15 s | Le modèle fal `wan-i2v` est plafonné à 100 images, soit 6,25 s : c'est annoncé dans le plan avant lancement. Aucun moteur intégré ne sait prolonger un clip. |
| Le texte n'est pas celui que j'ai écrit | Vous utilisez « Texte généré par le modèle » : aucun moteur intégré ne rend le texte de façon fiable. Choisissez « Incrustation nette ». |
| La musique ne correspond pas au style décrit | Aucun moteur intégré ne génère d'audio : c'est une nappe locale de ffmpeg. Remplacez la piste en montage pour un rendu professionnel. |
| « La génération a été bloquée par les filtres de sécurité » | Photo ou message refusé (allégations santé, marque tierce, personne identifiable). Changez la photo ou reformulez le message. |
| La vidéo ne s'affiche pas après une production réussie | Vérifiez d'abord que le fichier existe dans `outputs/`. Si oui, forcez le rechargement (Ctrl+F5) : un conflit CSS `[hidden]` a déjà provoqué ce symptôme, il est neutralisé par un garde-fou et vérifié par `npm test`. |
| « ffmpeg est introuvable » | `npm install` incomplet, ou définissez `FFMPEG_PATH`. Vérifiez avec `GET /api/diagnostics`. |
| La vidéo de 5 s fait 5,02 s | Normal : la coupe est précise à l'image près (1/30 s). |

---

## Limites connues

- **Aucun fournisseur n'est vérifié de bout en bout en conditions réelles** :
  l'adaptateur fal est conforme au schéma officiel du modèle mais n'a jamais
  abouti (compte sans crédit) ; l'adaptateur Replicate n'a jamais été exécuté et
  son schéma n'a pas pu être lu (il exige un jeton). Voir `RESUME.md`.
- Les **noms de paramètres varient d'un modèle à l'autre** : si un modèle refuse
  un champ, ajustez `server/providers/fal.js` / `replicate.js` en vous aidant de
  `check-provider-schema.mjs`, qui affiche le corps exact envoyé.
- Les moteurs intégrés ne produisent **ni audio ni texte** : la bande son est une
  nappe locale et le texte est incrusté par ffmpeg.
- **15 s n'est pas atteignable** avec les moteurs actuels (plafond de 6,25 s côté
  fal, 5 s côté Replicate).
- Une photo **carrée** produit un cadrage **9:16** (le format social par défaut).
- Le suivi des tâches est **en mémoire** : redémarrer le serveur perd l'historique
  (mais pas les fichiers produits, déjà écrits sur disque).
