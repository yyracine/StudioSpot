/**
 * Suggestions de messages publicitaires.
 *
 * Utilise un modele texte Gemini (gemini-2.5-flash), disponible sur le palier
 * gratuit — contrairement a Veo. C'est donc une aide gratuite, et elle reste
 * utile meme quand la generation video est refusee par le quota.
 *
 * Si aucune cle Gemini n'est configuree, on renvoie une liste locale de repli
 * construite a partir du nom du produit : l'interface propose toujours quelque
 * chose, sans jamais bloquer.
 */
import { getKey } from './config.js';
import { ProviderError } from './providers/http.js';

const MODEL = 'gemini-2.5-flash';
const API = 'https://generativelanguage.googleapis.com/v1beta';

/** Replis hors ligne : toujours disponibles, aucun appel reseau. */
function fallbackSuggestions(productName, videoTypeLabel) {
  const name = productName.trim();
  const bases = [
    {
      text: `Nouveau ! ${name} — -30 % cette semaine`,
      angle: 'Promotion',
    },
    {
      text: `Livraison offerte dès 40 €`,
      angle: 'Argument logistique',
    },
    {
      text: `${name} : l’essentiel, sans compromis`,
      angle: 'Promesse produit',
    },
    {
      text: `Édition limitée — stock réduit`,
      angle: 'Rareté',
    },
    {
      text: `Note 4,9/5 · plus de 2 300 avis`,
      angle: 'Preuve sociale',
    },
    {
      text: `Le choix des pros depuis 2019`,
      angle: 'Autorité',
    },
  ];

  // Une accroche adaptée au type de vidéo choisi.
  const byType = {
    rotation360: `${name}, sous tous les angles`,
    action: `Adoptez ${name} au quotidien`,
    unboxing: `Découvrez ${name} en 15 secondes`,
    beforeAfter: `Avant, après : la différence ${name}`,
  };
  if (videoTypeLabel && byType[videoTypeLabel.id]) {
    bases.unshift({ text: byType[videoTypeLabel.id], angle: 'Adapté au type de vidéo' });
  }

  return bases.slice(0, 5);
}

/**
 * Demande 5 messages courts a Gemini.
 * @param {{productName: string, videoTypeLabel?: string, ambiance?: string}} input
 */
export async function suggestMessages({ productName, videoTypeId, videoTypeLabel, ambianceLabel }) {
  const key = getKey('gemini');
  const name = String(productName || '').trim().slice(0, 60);

  if (!name) {
    throw new ProviderError('Renseignez d’abord le nom du produit.', {
      hint: 'Les suggestions s’appuient sur ce nom.',
    });
  }

  if (!key) {
    return { provider: 'repli local', suggestions: fallbackSuggestions(name, { id: videoTypeId }) };
  }

  const prompt = [
    'Tu es un copywriter spécialisé en publicité e-commerce.',
    `Produit : « ${name} ».`,
    videoTypeLabel ? `Le spot publicitaire est de type : ${videoTypeLabel}.` : '',
    ambianceLabel ? `Ambiance sonore : ${ambianceLabel}.` : '',
    '',
    'Propose 5 accroches publicitaires en FRANÇAIS, à incruster dans une vidéo verticale ou paysage.',
    'Contraintes STRICTES :',
    '- 45 caractères maximum par accroche (impératif, elles doivent tenir à l’écran) ;',
    '- ton concret et vendeur, sans jeu de mots douteux ni superlatif mensonger ;',
    '- pas d’emoji, pas de hashtag, pas de point final ;',
    '- si tu utilises une promotion chiffrée, reste générique et crédible.',
    '',
    'Réponds STRICTEMENT en JSON, sans texte autour, au format :',
    '{"suggestions":[{"text":"…","angle":"Promotion"}]}',
    'où « angle » vaut l’une de ces valeurs : Promotion, Rareté, Preuve sociale, Promesse produit, Urgence, Autorité.',
  ]
    .filter(Boolean)
    .join('\n');

  let response;
  try {
    response = await fetch(`${API}/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1, responseMimeType: 'application/json' },
      }),
    });
  } catch (err) {
    // Réseau indisponible : on dégrade proprement plutôt que d'échouer.
    return { provider: 'repli local', suggestions: fallbackSuggestions(name, { id: videoTypeId }) };
  }

  if (!response.ok) {
    const body = await response.text();
    // Le palier gratuit suffit pour ce modele, mais on reste robuste.
    if (response.status === 429 || /quota/i.test(body)) {
      return { provider: 'repli local (quota texte atteint)', suggestions: fallbackSuggestions(name, { id: videoTypeId }) };
    }
    throw new ProviderError('Les suggestions n’ont pas pu être générées.', {
      details: body.slice(0, 300),
    });
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text).join('') || '';

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Certains modèles encadrent le JSON de balises Markdown.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }

  const suggestions = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions
        .filter((item) => item?.text)
        .map((item) => ({
          text: String(item.text).replace(/\s+/g, ' ').trim().slice(0, 120),
          angle: String(item.angle || '').slice(0, 40),
        }))
        .slice(0, 5)
    : [];

  if (!suggestions.length) {
    return { provider: 'repli local', suggestions: fallbackSuggestions(name, { id: videoTypeId }) };
  }

  return { provider: MODEL, suggestions };
}
