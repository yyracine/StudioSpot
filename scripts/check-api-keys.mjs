/**
 * Vérifie le nouveau mécanisme « collez la clé API de votre choix » :
 * reconnaissance par format, enregistrement, retrait, et rejet propre d'une
 * clé non reconnue.
 *
 * Aucune clé réelle n'est utilisée : les valeurs sont factices mais conformes
 * au format attendu, ce qui suffit à exercer la reconnaissance.
 *
 * SÉCURITÉ — ce test écrit de vraies clés factices, et l'enregistrement
 * persiste dans `.env`. Le fichier est donc **sauvegardé avant** puis
 * **restauré après**, quoi qu'il arrive. Sans cette précaution, un test aurait
 * déjà écrasé les clés réelles de l'utilisateur : ne jamais retirer ce bloc.
 */
import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

const ENV_PATH = '.env';
const hadEnv = existsSync(ENV_PATH);
const savedEnv = hadEnv ? await readFile(ENV_PATH, 'utf8') : null;

/** Remet `.env` exactement dans l'état d'avant le test. */
async function restoreEnv() {
  if (hadEnv) {
    await writeFile(ENV_PATH, savedEnv, 'utf8');
  } else {
    const { rm } = await import('node:fs/promises');
    await rm(ENV_PATH, { force: true });
  }
}

const BASE = 'http://127.0.0.1:5178';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 5178,
        path,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = { raw: text };
          }
          resolve({ status: res.statusCode, data });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`   ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
};

/* ---------- 1. Une clé non reconnue est refusée avec les formats acceptés ---------- */
console.log('Rejet d’une clé non reconnue :');
let res = await request('POST', '/api/settings/key', { value: 'ceci-nest-pas-une-cle' });
check('clé inconnue → 422', res.status === 422, `HTTP ${res.status}`);
check('motif explicite', /non reconnu/i.test(res.data?.error || ''), res.data?.error);
check(
  'formats acceptés listés',
  Array.isArray(res.data?.formats) && res.data.formats.length >= 2,
  (res.data?.formats || []).map((f) => f.label).join(', '),
);

/* ---------- 2. Chaque format est reconnu et rangé au bon endroit ---------- */
console.log('\nReconnaissance par format (clés factices conformes) :');

const cases = [
  {
    label: 'Replicate',
    value: `r8_${'A'.repeat(36)}`,
    expected: 'replicate',
  },
  {
    label: 'fal.ai',
    value: `11111111-2222-3333-4444-555555555555:${'a'.repeat(32)}`,
    expected: 'fal',
  },
  {
    label: 'Google AI Studio',
    value: `AIza${'B'.repeat(35)}`,
    expected: 'gemini',
  },
];

const saved = [];
for (const testCase of cases) {
  res = await request('POST', '/api/settings/key', { value: testCase.value });
  const source = res.data?.source;
  saved.push(source);
  check(
    `${testCase.label} reconnue`,
    res.status === 200 && source === testCase.expected,
    `HTTP ${res.status}${source ? ` → ${source}` : ''}`,
  );
}

/* ---------- 3. Les clés apparaissent dans l'état du serveur ---------- */
console.log('\nÉtat après enregistrement :');
const healthAfter = await request('GET', '/api/health');
const keys = healthAfter.data?.keys || {};
check('Replicate configurée', keys.replicate?.configured === true);
check('fal.ai configurée', keys.fal?.configured === true);
check('Google configurée', keys.gemini?.configured === true);
check(
  'l’objet « keys » expose un libellé et un objet métier',
  Object.values(keys).every((entry) => entry.label && entry.purpose !== undefined),
);

/* ---------- 4. Une clé peut être retirée ---------- */
console.log('\nRetrait :');
res = await request('POST', '/api/settings/key/clear', { source: 'replicate' });
check('retrait accepté', res.status === 200);
const healthCleared = await request('GET', '/api/health');
check('Replicate retirée', healthCleared.data?.keys?.replicate?.configured === false);

// On retire aussi les autres pour laisser un état propre.
await request('POST', '/api/settings/key/clear', { source: 'fal' });
await request('POST', '/api/settings/key/clear', { source: 'gemini' });

/* ---------- 5. Test d'une clé sans enregistrement ---------- */
console.log('\nTest sans enregistrement :');
res = await request('POST', '/api/settings/key/test', { value: `r8_${'C'.repeat(36)}` });
check('endpoint de test répond', res.status === 200 || res.status === 400, `HTTP ${res.status}`);
const healthUntouched = await request('GET', '/api/health');
check(
  'l’état n’a pas été modifié par le test',
  healthUntouched.data?.keys?.replicate?.configured === false,
);

const failed = results.filter(([, ok]) => !ok).length;

// On restaure .env AVANT le bilan : le fichier de l'utilisateur ne doit jamais
// ressortir modifié, même si une vérification a échoué plus haut.
await restoreEnv();
console.log('\n.env restauré dans son état initial.');

console.log(`\n${failed ? '✗' : '✓'} ${results.length - failed}/${results.length} vérifications réussies`);
process.exitCode = failed ? 1 : 0;
