# Animateur de Photos Produit

Transformez **une photo de produit statique** en **vidéo publicitaire animée** :
l'application construit le prompt, appelle **Veo** (API Gemini) en image-to-video,
puis assure toute la post-production — texte promotionnel intégré, coupe à la
seconde exacte, ambiance sonore ou silence total.

Conçue pour le e-commerce et le marketing : vêtements, objets, tech.

---

## Sommaire

- [Ce que fait l'application](#ce-que-fait-lapplication)
- [Démarrage rapide](#démarrage-rapide)
- [Les 6 champs du formulaire](#les-6-champs-du-formulaire)
- [Comment la vidéo est produite](#comment-la-vidéo-est-produite)
- [Durées : la correspondance avec Veo](#durées--la-correspondance-avec-veo)
- [Texte promotionnel intégré](#texte-promotionnel-intégré)
- [Audio et « Pas de son »](#audio-et--pas-de-son)
- [Mode démo (sans clé API)](#mode-démo-sans-clé-api)
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

### Activer Veo

L'application démarre en **mode démo local** tant qu'aucune clé n'est
renseignée. Pour activer la génération Veo :

1. Créez une clé sur [Google AI Studio](https://aistudio.google.com/apikey)
   (Veo nécessite un projet avec **facturation activée**).
2. Cliquez sur **« Réglages »** dans l'interface et collez la clé.

La clé est conservée **côté serveur** (fichier `.env`) et n'est jamais renvoyée
au navigateur. Vous pouvez aussi la placer directement dans `.env` :

```bash
cp .env.example .env
# puis renseignez GEMINI_API_KEY=...
```

Le serveur n'écoute que sur `127.0.0.1` par défaut : ni les photos, ni les
vidéos, ni la clé ne sortent de la machine.

---

## Les 6 champs du formulaire

| Champ | Rôle |
|---|---|
| **Photo du produit** | Image source de l'animation. JPEG, PNG ou WebP, 25 Mo max. Elle est normalisée (redimensionnée à 1920 px max, ré-encodée en JPEG) avant l'envoi à Veo. Le cadrage (16:9 ou 9:16) est déduit de ses dimensions, sauf choix manuel. |
| **Nom du produit** | Repris **mot pour mot** dans le prompt pour que Veo préserve le produit, et affiché en bandeau haut dans la vidéo (60 caractères max). |
| **Message publicitaire** | Le texte promotionnel incrusté dans la vidéo (120 caractères max). Découpé automatiquement en lignes courtes pour rester lisible. |
| **Type de vidéo** | Détermine la mise en scène, le mouvement et le rythme (voir ci-dessous). |
| **Ambiance sonore** | Détermine la musique décrite à Veo, et si nécessaire la suppression de l'audio. |
| **Durée** | 5, 8 ou 15 secondes — traduite en plan de production réel. |

**Options avancées** : cadrage (auto / 16:9 / 9:16), définition (720p / 1080p),
modèle Veo (qualité ou *Fast*), et mode de rendu du texte.

### Les quatre types de vidéo

| Type | Mise en scène |
|---|---|
| **Rotation 360° élégante** | Plateau tournant, fond studio infini, rotation continue et sans à-coups qui révèle toutes les faces du produit. |
| **Produit en action / utilisation** | Scène de vie réelle, un adulte utilise le produit naturellement, caméra qui suit le geste. |
| **Unboxing dramatique** | Ouverture du packaging, gros plans matière, balayage lumineux et révélation finale en héro shot. |
| **Avant/Après transformation** | Match cut : l'état terne devient désirable au passage d'un balayage lumineux. |

---

## Comment la vidéo est produite

```
Photo ─► normalisation ─► prompt ─► VEO image-to-video ─► post-production ─► MP4
           (ffmpeg)                  (8 s, audio natif)      (ffmpeg)
```

1. **Préparation** — la photo est redimensionnée et ré-encodée, ses dimensions
   sont relevées, le cadrage et la résolution sont arrêtés.
2. **Prompt** — un prompt anglais structuré (la seule langue pleinement évaluée
   par Veo) assemble : la scène du type de vidéo choisi, un bloc de **fidélité
   produit** (« conserve forme, couleur, matière, logo, étiquettes »), le
   mouvement, les consignes de texte, l'ambiance sonore et les contraintes
   techniques.
3. **Génération Veo** — appel `generateVideos` en image-to-video, puis suivi de
   l'opération longue durée et téléchargement du MP4 (Veo ne conserve les
   vidéos que **2 jours**).
4. **Extension** (durée 15 s uniquement) — un second appel étend le plan de
   7 secondes à partir de la vidéo précédente.
5. **Post-production** — coupe à la seconde exacte, suppression de l'audio si
   « Pas de son », incrustation du texte promotionnel, extraction du poster et
   écriture des métadonnées.

L'avancement est diffusé en **Server-Sent Events** ; la production continue même
si vous fermez l'onglet.

---

## Durées : la correspondance avec Veo

Point important : **l'API Veo n'accepte que 4, 6 ou 8 secondes**. Les durées
demandées sont donc traduites en plan de production réel, sans jamais mentir sur
le résultat livré :

| Demandé | Ce qui est réellement produit |
|---|---|
| **5 s** | Veo génère **6 s**, puis ffmpeg coupe précisément à **5,00 s**. |
| **8 s** | Durée native du modèle : **8 s**. |
| **15 s** | Veo génère **8 s**, puis une **extension de +7 s** à partir du plan précédent — soit **exactement 15 s**. |

Contraintes appliquées automatiquement :

- l'extension impose **8 s, du 720p et un ratio 16:9 ou 9:16** ;
- le **1080p n'est disponible que pour des clips de 8 s** — ailleurs, la
  définition est ramenée à 720p ;
- l'image-to-video exige `personGeneration: "allow_adult"` ;
- l'application n'envoie que les paramètres documentés comme supportés par
  l'API Gemini (`generateAudio` et `lastFrame` n'y sont pas supportés pour
  Veo 3.x — les transmettre provoquerait une erreur).

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

| Ambiance | Prompt envoyé à Veo | Post-production |
|---|---|---|
| **Corporate professionnel** | Nappe propre, piano chaud, tempo posé, whoosh discret aux transitions. | — |
| **Énergique et fun** | Pop entraînante, beat marqué, claps, hook synthétique. | — |
| **Luxe et élégant** | Cordes soyeuses, nappe raffinée, shimmer, tempo lent. | — |
| **Pas de son** | Silence total demandé dans le prompt. | **Piste audio supprimée** (`-an`) : la vidéo est réellement muette, quoi que produise Veo. |

Chaque prompt précise « instrumental seulement : ni dialogue, ni voix off, ni
paroles ».

---

## Mode démo (sans clé API)

Sans clé API Gemini — ou avec `DEMO=1` — l'application reste **entièrement
utilisable et testable** : la photo est animée localement par un effet Ken Burns
(`zoompan`), l'habillage texte est **exactement le même** que pour une vidéo
Veo, et une nappe sonore est synthétisée par ffmpeg selon l'ambiance choisie
(accord dont le timbre et la pulsation varient). L'option « Pas de son » produit
là aussi une vidéo réellement muette.

Cela permet de valider le cadrage, le texte et le montage sans dépenser le
moindre crédit Veo. L'interface signale clairement ce mode.

Ce mode sert aussi de **repli immédiat** : si un appel Veo est refusé (quota,
accès, filtre de sécurité), la zone d'erreur propose « **Relancer en mode démo
local** », qui reproduit la vidéo à partir de la même photo et des mêmes
réglages, sans nouvel appel Veo. Vous n'êtes jamais laissé sans résultat.

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

Toutes les variables sont optionnelles sauf la clé (`voir .env.example`) :

| Variable | Défaut | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | Clé Google AI Studio. Sans elle : mode démo. |
| `PORT` | `5178` | Port d'écoute. |
| `HOST` | `127.0.0.1` | Interface d'écoute (boucle locale par défaut). |
| `DEMO` | — | `1` force le mode démo, même avec une clé. |
| `FFMPEG_PATH` | paquet npm | Chemin vers un ffmpeg spécifique. |

---

## API HTTP

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/health` | État du serveur, mode (Veo/démo), ffmpeg, police. |
| `GET` | `/api/options` | Catalogues des listes déroulantes (source unique de vérité). |
| `GET` | `/api/plan?duration=&model=` | Plan de production (appels Veo, coupe, résolution). |
| `POST` | `/api/jobs` | Crée une production (`multipart/form-data`). |
| `GET` | `/api/jobs/:id` | État d'une production. |
| `GET` | `/api/jobs/:id/events` | Avancement en **SSE**. |
| `GET` | `/api/jobs/:id/video` | Vidéo finale (`?download=1` pour forcer le téléchargement). |
| `GET` | `/api/jobs/:id/poster` | Image de poster. |
| `GET` | `/api/jobs/:id/source` | Photo source (aperçu). |
| `GET` | `/api/jobs/:id/meta` | Métadonnées (réglages, prompt utilisé). |
| `POST` | `/api/jobs/:id/retry` | Relance avec les mêmes réglages. Corps `{"mode":"demo"}` pour forcer un rendu local sans appel Veo. |
| `POST` | `/api/settings/api-key` | Enregistre et vérifie la clé Gemini. |
| `POST` | `/api/settings/api-key/clear` | Retire la clé (retour au mode démo). |
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
  -F durationId=8
```

---

## Tests

Le serveur doit tourner (`npm start`) dans un autre terminal.

```bash
npm test                                  # 8 s, corporate, habillage complet
node scripts/smoke-test.mjs --duration 5
node scripts/smoke-test.mjs --duration 15 --ambiance aucun
node scripts/smoke-test.mjs --duration 5 --vertical --ambiance luxe --videoType beforeAfter
```

Le test de bout en bout :

1. fabrique une **photo produit synthétique** avec ffmpeg ;
2. envoie le formulaire complet en **forçant le mode démo local** ;
3. suit la production réelle ;
4. télécharge la vidéo et **vérifie la durée, la définition et la présence ou
   l'absence de piste audio** ;
5. contrôle la cohérence des identifiants DOM entre `index.html` et `app.js`.

Il est **gratuit et déterministe** : il n'appelle jamais Veo, même quand une clé
est configurée, et exerce exactement le même chemin de post-production
(incrustation texte, coupe, suppression audio). Pour tester un vrai appel Veo
(un crédit est consommé) :

```bash
node scripts/smoke-test.mjs --veo
```

---

## Architecture

```
server/
  index.js     serveur HTTP, upload, validation, routes SSE
  config.js    source unique de vérité : catalogues, bornes, plan de durées
  prompts.js   construction des prompts Veo + configuration d'appel
  veo.js       client Veo : génération, extension, suivi, téléchargement
  ffmpeg.js    post-production : coupe, audio, habillage, rendu démo
  pipeline.js  orchestration d'une production complète
  jobs.js      suivi des tâches + diffusion SSE
public/
  index.html   structure de l'interface
  styles.css   thème studio sombre
  app.js       logique client, aperçu fidèle de l'habillage
scripts/
  smoke-test.mjs  test de bout en bout
```

---

## Dépannage

| Symptôme | Cause probable et solution |
|---|---|
| Le bandeau indique « Mode démo local » | Aucune clé API valide. Cliquez sur « Réglages » et ajoutez la clé. |
| « Clé API refusée par Google » | Clé erronée ou expirée : régénérez-la dans AI Studio. |
| **« Veo a refusé la requête : quota ou accès indisponible (429) »** | Cause la plus fréquente : **le projet Google n'est pas sur un palier payant**. Veo est un modèle *preview* qui exige un compte de facturation actif (palier **Tier 1** : « link an active billing account »). Vérifiez vos limites réelles sur <https://aistudio.google.com/rate-limit> : **si Veo y affiche 0, il faut activer la facturation** sur le projet lié à la clé. S'il s'agit d'une vraie limite de débit, patientez une minute. Le message « check your plan and billing details » de Google désigne le palier, pas une panne. |
| Bloqué par ce 429 et vous voulez avancer tout de suite | Cliquez sur **« Relancer en mode démo local »** dans la zone d'erreur : la vidéo est produite immédiatement, avec le même habillage et la même bande son, sans appel Veo ni coût. |
| « Veo n'est pas disponible pour ce projet » | Facturation absente sur le projet Google, ou région non desservie. |
| « La génération a été bloquée par les filtres de sécurité » | Photo ou message refusé (allégations santé, marque tierce, personne identifiable). Changez la photo ou reformulez le message. |
| « Veo n'a renvoyé aucune vidéo » | Fréquent quand l'**audio** est bloqué par les filtres. Relancez la génération. |
| « ffmpeg est introuvable » | `npm install` incomplet, ou définissez `FFMPEG_PATH`. Vérifiez avec `GET /api/diagnostics`. |
| La vidéo de 5 s fait 5,04 s | Normal : la coupe est précise à l'image près (1/30 s). |
| Production très lente | Veo peut dépasser 6 minutes aux heures de pointe, et 15 s enchaîne deux générations. |

---

## Limites connues

- **Veo 3.1 est un modèle en aperçu** : disponibilité, quotas et tarifs peuvent
  évoluer.
- Les vidéos Veo sont **supprimées au bout de 2 jours** côté Google — le
  téléchargement local est donc effectué immédiatement. Les fichiers produits
  restent, eux, dans `outputs/`.
- L'**extension vidéo n'est possible que sur des vidéos générées par Veo**, en
  8 s et 720p — c'est la raison des contraintes appliquées à l'option 15 s.
- Chaque vidéo Veo porte un **filigrane invisible SynthID**.
- En mode « Texte généré par Veo », l'orthographe du texte affiché n'est pas
  garantie : préférez l'incrustation (mode par défaut) pour une accroche
  commerciale.
- Le suivi des tâches est **en mémoire** : redémarrer le serveur perd l'historique
  (mais pas les fichiers produits, déjà écrits sur disque).
