/**
 * 🥊 FETCHER COMPARTILHADO DE DADOS FÍSICOS DE LUTADOR (ESPN)
 *
 * Usado por:
 *   - api/get-espn-events.js   (busca em lote, todos os lutadores de um card)
 *   - api/get-fighter-espn.js  (busca individual, fallback do frontend)
 *
 * Por que isso existe:
 *   Antes, get-espn-events.js refazia o fetch de altura/envergadura/cartel
 *   de TODOS os lutadores toda vez que o cache do evento (1h) expirava —
 *   mesmo que esses dados quase nunca mudem. Isso gerava ~24 chamadas de
 *   rede sequenciais por evento, deixando os cards lentos pra carregar.
 *
 *   Agora cada lutador tem cache próprio de 7 dias, guardado em memória
 *   do processo serverless (sobrevive entre invocações "warm" da mesma
 *   função, que é o caso comum no Vercel pra funções que recebem tráfego
 *   constante). Isso faz com que, na prática, cada lutador só seja
 *   buscado de verdade uma vez por semana — todos os outros acessos
 *   batem no cache e respondem na hora.
 */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

// Cache em memória do processo. Usamos `global` para garantir que o
// mesmo Map seja reaproveitado entre invocações warm da função serverless.
if (!global._fighterEspnCache) {
  global._fighterEspnCache = new Map();
}
const cache = global._fighterEspnCache;

/**
 * Faz um fetch com timeout defensivo, para que uma chamada lenta da ESPN
 * nunca trave a função inteira (e estoure o limite de execução do Vercel).
 */
async function fetchWithTimeout(url, ms = 4000) {
  return Promise.race([
    fetch(url),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout após ${ms}ms: ${url}`)), ms)
    ),
  ]);
}

const inchToCm = (inch) => (inch ? Math.round(inch * 2.54) : null);

/**
 * Busca dados físicos (altura, envergadura, stance, cartel) de um lutador
 * na ESPN Core API, dado o seu ESPN athlete ID. Usa cache em memória de 7 dias.
 *
 * @param {string} fighterId - ID numérico do atleta na ESPN
 * @returns {Promise<object>} { height_cm, reach_cm, stance, wins, losses, draws }
 */
async function fetchFighterPhysicalData(fighterId) {
  if (!fighterId) {
    return { height_cm: null, reach_cm: null, stance: '', wins: null, losses: null, draws: 0 };
  }

  const cached = cache.get(fighterId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  let height_cm = null, reach_cm = null, stance = '';
  let wins = null, losses = null, draws = 0;

  try {
    const athleteUrl = `https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/athletes/${fighterId}`;
    const athleteReq = await fetchWithTimeout(athleteUrl);

    if (athleteReq.ok) {
      const athleteData = await athleteReq.json();

      height_cm = inchToCm(athleteData.height);
      reach_cm = inchToCm(athleteData.reach);

      if (athleteData.position && athleteData.position.text) {
        stance = athleteData.position.text;
      } else if (athleteData.displayStance) {
        stance = athleteData.displayStance;
      }

      // Busca o cartel (wins/losses/draws), também com timeout próprio
      if (athleteData.records && athleteData.records.$ref) {
        try {
          const recordsUrl = athleteData.records.$ref.replace('http://', 'https://');
          const recordsReq = await fetchWithTimeout(recordsUrl);
          if (recordsReq.ok) {
            const recordsData = await recordsReq.json();
            if (recordsData && recordsData.items && recordsData.items.length > 0) {
              const summary = recordsData.items[0].summary; // ex: "13-5-0"
              if (summary) {
                const parts = summary.split('-');
                if (parts.length >= 2) {
                  wins = parseInt(parts[0]) || 0;
                  losses = parseInt(parts[1]) || 0;
                  draws = parseInt(parts[2]) || 0;
                }
              }
            }
          }
        } catch (err) {
          console.warn(`[ESPN Fetcher] Falha ao buscar records de ${fighterId}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.warn(`[ESPN Fetcher] Falha ao buscar dados de ${fighterId}:`, err.message);
  }

  const data = { height_cm, reach_cm, stance, wins, losses, draws };
  cache.set(fighterId, { data, ts: Date.now() });
  return data;
}

module.exports = { fetchFighterPhysicalData, fetchWithTimeout, inchToCm };
