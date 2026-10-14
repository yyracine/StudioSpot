# RESUME — Animateur de Photos Produit

> Document de passation. À lire **en premier** au début d'une nouvelle session.
> Dernière mise à jour : commit `8a39a0e` (branche `main`, poussée sur GitHub).

---

## 1. En une phrase

Application web locale qui transforme **une photo de produit** en **vidéo
publicitaire** : elle construit le prompt, appelle un moteur image-to-video
(Veo, fal.ai ou Replicate), puis assure en local l'habillage texte, la coupe
exacte, l'audio et le silence. **27 fichiers suivis, ≈ 6 870 lignes**
(dont 6 187 de code et 681 de documentation).

---

## 2. Accès rapide

| | |
|---|---|
| **Dossier** | `C:\Users\HP\Documents\Dev\VibeCoding\StudioSpot` |
| **Dépôt** | https://github.com/yyracine/StudioSpot (`main`, à jour) |
| **Lancer** | `npm start` → http://127.0.0.1:5178 |
| **Tester** | `npm test` (gratuit, aucun appel distant) |
| **Utilisateur** | francophone, exige de l'honnêteté sur les limites. Répondre en français. |

**Clés présentes dans `.env` (non versionné, valeurs jamais recopiées ici) :**

| Clé | État | Conséquence |
|---|---|---|
| `GEMINI_API_KEY` | renseignée (53 car.) | Modèles **texte OK**, mais Veo et les modèles image renvoient **429** : projet Google sans facturation |
| `FAL_KEY` | renseignée (72 car.) | fal **refuse** : `User is locked. Reason: Exhausted balance` — compte sans crédit |
| `REPLICATE_API_TOKEN` | absente | adaptateur jamais exécuté |

**Bilan pratique : aujourd'hui, seul le rendu local fonctionne.** C'est le
chemin gratuit et garanti ; il a été réparé au dernier commit.

---

## 3. Ce que fait l'application

Formulaire : **zone d'upload** (glisser-déposer / parcourir / `Ctrl+V`),
**nom du produit** (60 car.), **message publicitaire** (120 car., avec bouton de
suggestions), puis trois listes déroulantes et le bouton **« Animer mon
produit »**.

- **11 types de vidéo** : Rotation 360°, Packshot, Macro, Fonctionnement,
  Lévitation, Stop-motion, Unboxing, Avant/Après, Lifestyle, Porté en mouvement
  (mode), Action/utilisation.
- **11 ambiances sonores** : Corporate, Énergique, Luxe, Cinématique,
  Minimaliste, Chaleureux, Urbain, Tendance réseaux sociaux, Tension dramatique,
  Naturel, **Pas de son**.
- **3 durées** : 5 / 8 / 15 s.
- **Options avancées** : moteur de génération, cadrage, définition, modèle Veo,
  rendu du texte.
- Résultat : lecteur vidéo, téléchargement MP4, prompt utilisé, journal de
  production en direct (SSE).

---

## 4. Architecture et deux concepts clés

```
server/
  index.js        HTTP : upload, validation, routes, SSE
  config.js       SOURCE UNIQUE DE VÉRITÉ : catalogues, bornes, clés
  prompts.js      prompts construits depuis le PLAN du moteur
  pipeline.js     orchestration — ne connaît AUCUN moteur
  jobs.js         suivi des tâches + diffusion SSE
  ffmpeg.js       post-production : coupe, audio, habillage, rendu local
  suggest.js      accroches publicitaires (modèle texte, gratuit)
  providers/
    index.js      registre + sélection du moteur
    http.js       polling, téléchargement, traduction des erreurs
    veo.js  fal.js  replicate.js
public/  index.html · styles.css · app.js
scripts/  smoke-test · check-providers · check-provider-schema
          check-catalog · check-ui-hidden · probe-key
```

### Concept 1 — le « plan » de production

Chaque moteur déclare ce qu'il va **réellement** produire
(`buildPlan({durationId, aspectRatio, resolution})`) : nombre d'appels, durée de
chacun, coupe finale, résolution, limitation éventuelle. **Aucune durée n'est
codée en dur dans le pipeline.** C'est ce qui permet d'annoncer honnêtement
« 15 s demandées → 6,25 s livrées » au lieu de mentir.

| Demandé | Veo | fal (`wan-i2v`) |
|---|---|---|
| 5 s | 6 s produites → coupées à 5,00 s | 5,06 s → coupées à 5,00 s |
| 8 s | 8 s natives | **6,25 s** (plafond du modèle) |
| 15 s | 8 s + extension 7 s = **15 s** | **6,25 s** |

### Concept 2 — les capacités du moteur

`capabilities: { nativeAudio, rendersText, extension, resolutions }` ne sont pas
décoratives, elles changent le comportement :
- pas d'audio natif → **nappe sonore locale** ajoutée par ffmpeg ;
- pas de rendu de texte → bascule **automatique** sur l'incrustation ffmpeg,
  avec avertissement dans le journal ;
- pas d'extension → durée plafonnée et **annoncée**.

**Ajouter un moteur = écrire un fichier dans `server/providers/`** et
l'inscrire dans `providers/index.js`. L'interface `describeRequest()` décrit
l'appel **sans l'envoyer** : c'est ce qui permet de valider un adaptateur sans
clé.

---

## 5. Contraintes de CETTE machine (à ne pas redécouvrir)

Ces points ont coûté du temps. Ils sont **spécifiques à cet environnement
confiné** et se reproduiront.

1. **Cache npm hors du dossier → EPERM.** Toujours :
   `$env:npm_config_cache = "$PWD\.npm-cache"`.
2. **Les scripts de cycle de vie npm échouent** (`spawn EPERM`, le bac à sable
   interdit les tubes nommés) → installer avec `npm install --ignore-scripts`.
3. **`child_process` avec `stdio: 'pipe'` → EPERM.** C'est la contrainte la plus
   importante : **tout appel à ffmpeg doit écrire son journal dans un fichier via
   un descripteur** (`stdio: ['ignore','ignore', fd]`). C'est le choix retenu dans
   `server/ffmpeg.js` — ne pas le « simplifier » en tube.
4. **`curl.exe` et `Invoke-WebRequest` n'ont aucun accès réseau.** `fetch` de Node
   fonctionne pour l'extérieur, **mais pas vers `127.0.0.1`** → pour interroger le
   serveur local, utiliser `node:http`.
5. **`git push` exige une escalade `danger-full-access`** (Git Credential Manager
   a besoin de tubes nommés). Les identifiants de `yyracine` sont déjà dans le
   gestionnaire Windows. Fournir une `justification` d'une phrase. Le code de
   sortie 1 est normal (git écrit sur stderr).
6. **`Select-Object -First N` tue le processus** qu'on pipe (SIGPIPE). Ne jamais
   piper la sortie d'un serveur ; rediriger vers un fichier.
7. **`node -e "…"` est massacré par PowerShell** (guillemets, `\r\n`, regex).
   **Toujours écrire un fichier `.mjs`** puis l'exécuter.
8. **ffmpeg fourni = version 4.1** (`@ffmpeg-installer/win32-x64`) :
   - `drawbox` n'accepte que des **constantes**, pas d'expressions → calculer en JS ;
   - `drawtext` : le chemin de police doit échapper les `:` (`C\:/Windows/...`) ;
   - une option de filtre ne peut pas contenir de `:` non échappé → **lancer
     ffmpeg avec `cwd` réglé sur le dossier et n'utiliser que des noms simples**
     (`textfile=overlay.txt`) ;
   - **pas de `ffprobe`** → durée et dimensions se lisent en analysant le journal
     de `ffmpeg -i` (code de sortie 1 attendu : utiliser une variante tolérante).
9. **`ffmpeg-static` est inutilisable ici** : son téléchargement depuis GitHub
   Release se bloque et produit un binaire corrompu. La solution retenue est
   `@ffmpeg-installer/ffmpeg`, dont le binaire est **dans l'archive npm**.

---

## 6. Piège navigateur (cause du dernier bug)

**Une règle CSS d'auteur sur `display` écrase le `[hidden] { display: none }` du
navigateur.** Donc `element.hidden = true` n'a **aucun effet** si l'élément a par
ailleurs `display: flex` ou `block`.

Conséquence observée : `.stage-placeholder` (`position:absolute`, après le média
dans le DOM, `display:flex`) **recouvrait la vidéo pourtant produite** →
l'utilisateur voyait « Votre vidéo apparaîtra ici » et croyait que rien ne
marchait, alors que les fichiers étaient bien créés sur le disque.

Correctif : garde-fou global `[hidden] { display: none !important }`.
Contrôle permanent : `scripts/check-ui-hidden.mjs` (inclus dans `npm test`).

**Leçon générale : un test d'API ne verra jamais un bug de rendu.** Ce bug a
survécu à 40+ vérifications parce qu'aucune n'exerçait le navigateur.

---

## 7. Bugs trouvés et corrigés (à ne pas réintroduire)

| # | Bug | Cause |
|---|---|---|
| 1 | Échec silencieux sans message | `run()` rejetait un objet nu : `{...error}` perd `message` (propriété non énumérable) |
| 2 | ffmpeg « fichier introuvable » | `path.basename()` sur une entrée située hors du `cwd` |
| 3 | `final.mp4` au mauvais endroit | sorties résolues relativement au `cwd` au lieu du dossier de tâche → **toutes les sorties sont désormais absolues** |
| 4 | Bouton « Réessayer » cassé | `enterRunningState()` remettait `state.jobId` à zéro **avant** la construction de l'URL `/retry` |
| 5 | `npm test` consommait du quota Veo | le test tentait un vrai appel dès qu'une clé existait → il **force** désormais le rendu local |
| 6 | Plan affiché faux | « Rendu local » annonçait le coût de Veo → `provider=demo` explicite |
| 7 | fal : premier appel condamné | `duration` **n'existe pas** chez fal (→ `num_frames` + `frames_per_second`) et `resolution` n'accepte que `480p`/`720p` |
| 8 | **Placeholder couvrant la vidéo** | voir §6 |
| 9 | `a 8 second` | article anglais : 8, 11 et 18 prennent `an` |
| 10 | Erreur fal trompeuse | solde épuisé renvoyé en 401 → affiché « clé refusée ». Messages dédiés au solde, 402, 404, 422 |

---

## 8. Vérifications : ce qui est prouvé, ce qui ne l'est pas

**Toutes ces suites passent** (dernière exécution : commit `8a39a0e`) :

| Suite | Objet |
|---|---|
| `npm test` | bout en bout (9 vérifications, dont 3 sur la nappe locale) **+** conflits `hidden`/CSS |
| `npm run test:catalog` | 33 points : 11 types × 11 ambiances produisent un prompt cohérent |
| `npm run test:providers` | 27 points (adaptateurs) + 8 points (schéma officiel fal) |
| `scripts/probe-key.mjs` | ce que la clé Gemini peut réellement appeler |

Points **vérifiés réellement** : durées livrées, présence/absence de piste audio,
lecture partielle HTTP 206 (indispensable à la timeline), position de
l'habillage texte, nappe sonore locale, cohérence des identifiants DOM,
catalogues, erreurs d'API, cas photo carrée → 9:16 en rendu local.

**Ce qui n'est PAS prouvé — à ne jamais présenter comme acquis :**

- **L'adaptateur fal n'a jamais abouti** (compte sans crédit). Il est conforme au
  schéma officiel, mais le premier appel réussi reste à faire.
- **L'adaptateur Replicate n'a jamais été exécuté** et son schéma n'a pas pu être
  lu (il exige un jeton 401). Son corps d'appel est volontairement minimal
  (`prompt` + `image`).
- **Veo n'a jamais généré** : quota refusé (429, projet sans facturation).
- **Aucune vérification visuelle** : le modèle courant **ne lit pas les images**
  (`read_image` échoue). D'où la technique employée : comparer deux rendus
  (avec / sans texte) par **différence de luminance sur des bandes ciblées** de
  l'image, ce qui a confirmé la position du texte (bande du nom 4–12 % et bande
  du message 62–80 % modifiées, bande témoin 38–48 % **pixel-identique**).

---

## 9. Ce qui bloque, et les options

**Blocage actuel : aucun moteur distant utilisable** (Google sans facturation,
fal sans solde).

| Option | Coût | Commentaire |
|---|---|---|
| **Rendu local** | 0 € | Fonctionne (réparé). Animation Ken Burns, habillage exact, nappe locale. |
| **Recharger fal.ai** | quelques € | Le plus simple : un clip Wan 720p coûte quelques centimes. Compte actuellement `Exhausted balance`. |
| **Activer la facturation Google** | payant | Veo reste le meilleur rendu (audio natif + texte fidèle). |
| **Colab gratuit + Wan 2.2 / LTX** | 0 € | Vraiment gratuit mais manuel, sessions limitées. La machine locale ne peut pas (Intel UHD 620, pas de CUDA). |
| **Mode « clip importé »** *(proposé, non implémenté)* | 0 € | Générer le mouvement sur une interface web à crédits quotidiens (Kling, Hailuo), puis appliquer texte + audio + coupe dans l'app. |

> **NVIDIA : écarté, vérifié.** Nemotron 3 Nano Omni est un **LLM multimodal**
> (comprend vision/audio/langage), pas un générateur vidéo. Le catalogue d'API
> NVIDIA interrogé en direct compte 80 modèles et **aucun générateur vidéo** —
> seulement `ai-synthetic-video-detector` (détection) et `cosmos-reason2-8b`
> (raisonnement). Cosmos *Predict* existe en poids ouverts mais exige un gros GPU.

---

## 10. Commandes utiles

```bash
npm start                    # http://127.0.0.1:5178
npm test                     # gratuit, déterministe, aucun appel distant
npm run test:catalog
npm run test:providers

node scripts/smoke-test.mjs --duration 15 --ambiance aucun
node scripts/smoke-test.mjs --vertical --duration 5
node scripts/smoke-test.mjs --veo            # vrai appel Veo (payant)

node scripts/probe-key.mjs                   # diagnostic de clé Gemini
node scripts/check-provider-schema.mjs       # nos requêtes vs schéma fal officiel
node scripts/check-ui-hidden.mjs             # conflits hidden / CSS
```

---

## 11. Méthodes qui ont fait la différence

À réutiliser :

1. **Vérifier la source de vérité, pas la documentation.** Le schéma OpenAPI
   publié par fal a révélé deux champs invalides que la doc n'exposait pas
   (pages rendues en JavaScript). Le client officiel fal publié **sur npm** a
   livré le flux exact de téléversement en lisant son code compilé.
2. **`describeRequest()`** : décrire la requête sans l'envoyer → valider un
   adaptateur sans clé ni crédit.
3. **Reproduire le cas de l'utilisateur avec la BONNE fixture.** J'ai d'abord
   testé un cas vertical avec une photo paysage — donc je ne reproduisais pas le
   bug. Sa photo était **carrée** (1254×1254), ce qui déclenche le cadrage 9:16.
4. **Chercher les conflits structurels** plutôt que corriger un symptôme : c'est
   le repérage systématique des éléments masqués qui a trouvé les 5 conflits CSS.
5. **Suivre les étapes d'un problème en série** : `npm install` détaillé a permis
   d'isoler la restriction sur les tubes nommés avant qu'elle ne bloque ffmpeg.

---

## 12. Règles de collaboration

- Répondre **en français**, ton direct, sans flatterie.
- **Signaler explicitement ce qui est vérifié et ce qui ne l'est pas.** Ne jamais
  présenter un adaptateur non exécuté comme fonctionnel.
- Corriger les erreurs **et le dire** : plusieurs bugs venaient de mes propres
  éditions (voir §7), corrigés après vérification.
- Le push GitHub demande une escalade `danger-full-access` (voir §5.5) ;
  `.env` est dans `.gitignore` et **ne doit jamais être committé** — vérifier
  avant chaque commit.
