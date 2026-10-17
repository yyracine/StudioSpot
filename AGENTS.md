# AGENTS.md — consignes chargées automatiquement par DSH

> Ce fichier est lu au démarrage de **chaque** session dans ce dossier.
> Il ne remplace pas la documentation : il dit où aller et ce qui casse.

## 1. À lire avant d'agir

**`RESUME.md`** est le document de passation : état du dépôt, architecture,
contraintes de la machine, bugs déjà corrigés, et surtout **ce qui n'est pas
vérifié**. Le lire en premier évite de refaire des erreurs déjà tranchées.

`README.md` documente l'usage et les options pour l'utilisateur final.

## 2. Contraintes de cet environnement (elles cassent silencieusement)

1. **`child_process` avec `stdio: 'pipe'` → EPERM.** Tout appel à ffmpeg doit
   écrire son journal dans un **fichier via un descripteur** :
   `spawn(bin, args, { stdio: ['ignore','ignore', fd] })`. Ne pas « simplifier »
   en tube — c'est la contrainte la plus coûteuse du projet.
2. **Cache npm hors du dossier → EPERM** :
   `$env:npm_config_cache = "$PWD\.npm-cache"`, et installer avec
   `npm install --ignore-scripts` (les scripts de cycle de vie échouent).
3. **`curl.exe` / `Invoke-WebRequest` n'ont aucun réseau.** `fetch` de Node
   fonctionne vers l'extérieur, **mais pas vers `127.0.0.1`** → pour le serveur
   local, utiliser `node:http`.
4. **Ne pas écrire de script dans `node -e "…"`** : PowerShell massacre les
   guillemets, `\r\n` et les regex. **Écrire un `.mjs`** puis l'exécuter.
5. **`Select-Object -First N` tue le processus pipé** (SIGPIPE). Rediriger vers
   un fichier au lieu de piper un serveur.
6. **`git push` exige `sandbox_permissions: danger-full-access`** avec une
   `justification` d'une phrase (Git Credential Manager a besoin de tubes
   nommés). Le code de sortie 1 est normal : git écrit sur stderr.
7. **ffmpeg fourni = version 4.1** : `drawbox` n'accepte que des constantes
   (calculer en JS), pas de `ffprobe` (analyser le journal de `ffmpeg -i`), et
   un `:` dans un chemin de filtre doit être échappé — lancer ffmpeg avec un
   `cwd` et des noms de fichiers simples.

## 3. Piège navigateur à ne pas réintroduire

Une règle CSS d'auteur sur `display` **écrase** le `[hidden] { display: none }`
du navigateur : `element.hidden = true` devient sans effet. Cela a déjà caché
une vidéo pourtant produite derrière un message « votre vidéo apparaîtra ici ».
Le garde-fou global `[hidden] { display: none !important }` doit rester, et
`scripts/check-ui-hidden.mjs` le vérifie.

**Un test d'API ne verra jamais un bug de rendu.** Ce bug a survécu à plus de
40 vérifications parce qu'aucune n'exerçait le navigateur.

## 4. Conventions

- Répondre **en français**, ton direct, sans flatterie.
- **Distinguer explicitement ce qui est vérifié de ce qui ne l'est pas.** Ne
  jamais présenter comme fonctionnel un adaptateur qui n'a jamais abouti.
- `.env` contient les clés et **ne doit jamais être committé** (il est dans
  `.gitignore`). Vérifier avant chaque commit.
- `npm test` doit rester **gratuit et déterministe** : il force le rendu local
  et n'appelle aucun moteur distant.
- Le pipeline ne connaît **aucun** moteur : toute spécificité va dans
  `server/providers/`. Les durées se déduisent du **plan** déclaré par le
  moteur, jamais d'une valeur codée en dur.

## 5. État au dernier passage (voir RESUME.md pour le détail)

Aucun moteur distant utilisable : Gemini sans facturation (**429** sur Veo et
sur les modèles image), fal.ai **sans solde** (`Exhausted balance`), Replicate
**jamais exécuté**. Seul le **rendu local** fonctionne — c'est le chemin gratuit
et garanti, et il est vérifié de bout en bout.

Ne pas proposer NVIDIA Nemotron comme moteur vidéo : c'est un LLM multimodal,
et le catalogue d'API NVIDIA ne contient **aucun** générateur vidéo (vérifié).
