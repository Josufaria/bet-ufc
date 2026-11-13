const axios  = require('axios');
const FIGHTERS_DB = require('./fighters-db-node');

const HEADERS = { 'User-Agent': 'UFCBetStats/1.0 (educational project)' };
const TIMEOUT = 9000;

// ═══════════════════════════════════════════════════════════════════
// 1. BANCO DE DADOS LOCAL (física – rápido, sem custo)
// ═══════════════════════════════════════════════════════════════════
function lookupInDB(name) {
  if (!name) return null;
  const nl = name.toLowerCase().trim();

  if (FIGHTERS_DB[nl]) return { ...FIGHTERS_DB[nl] };

  const words = nl.split(/\s+/).filter(w => w.length > 2);
  let bestMatch = null;

  for (const [key, data] of Object.entries(FIGHTERS_DB)) {
    if (key.includes(nl) || nl.includes(key)) {
      if (!bestMatch || (bestMatch.reach_cm === 0 && data.reach_cm > 0))
        bestMatch = { ...data };
    }
    const keyWords = key.split(/\s+/);
    if (words.some(w => keyWords.includes(w))) {
      if (!bestMatch || (bestMatch.reach_cm === 0 && data.reach_cm > 0))
        bestMatch = { ...data };
    }
  }
  return bestMatch;
}

// ═══════════════════════════════════════════════════════════════════
// 2. WIKIPEDIA (parser robusto para cartel, idade e histórico)
// ═══════════════════════════════════════════════════════════════════
async function lookupInWikipedia(name) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name + ' mma fighter')}&utf8=&format=json`;
    const r = await axios.get(searchUrl, { headers: HEADERS, timeout: TIMEOUT });

    if (!r.data?.query?.search?.length) return null;

    const title = r.data.query.search[0].title;
    if (!title.toLowerCase().includes(name.toLowerCase().split(' ')[0])) return null;

    const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(title)}&format=json`;
    const r2  = await axios.get(contentUrl, { headers: HEADERS, timeout: TIMEOUT });
    const pages = r2.data?.query?.pages;
    if (!pages) return null;

    const pageId = Object.keys(pages)[0];
    if (pageId === '-1') return null;

    const rev = pages[pageId].revisions?.[0];
    if (!rev) return null;

    const content = rev.slots ? rev.slots.main['*'] : rev['*'];
    if (!content) return null;

    // ── Altura ─────────────────────────────────────────────────────
    let height_cm = null;
    const hM = content.match(/height\s*=\s*(.*?)\n/);
    if (hM) {
      const hs = hM[1];
      if (hs.includes('ft=')) {
        const ft = parseInt(hs.match(/ft=(\d+)/)?.[1] || 0);
        const inc = parseInt(hs.match(/in=(\d+)/)?.[1] || 0);
        if (ft > 0) height_cm = Math.round((ft * 12 + inc) * 2.54);
      } else {
        const cm = hs.match(/(\d{2,3})\s*cm/);
        if (cm) height_cm = parseInt(cm[1]);
      }
    }

    // ── Envergadura ────────────────────────────────────────────────
    let reach_cm = null;
    const rM = content.match(/reach\s*=\s*(.*?)\n/);
    if (rM) {
      const rs = rM[1];
      const inM = rs.match(/(\d+(?:\.\d+)?)\s*in/);
      if (inM) reach_cm = Math.round(parseFloat(inM[1]) * 2.54);
      const cm = rs.match(/(\d{2,3})\s*cm/);
      if (!reach_cm && cm) reach_cm = parseInt(cm[1]);
    }

    // ── Estilo / Stance ────────────────────────────────────────────
    const lc = content.toLowerCase();
    let style = 'All-Round';
    if (lc.includes('wrestling') || lc.includes('ncaa'))                                style = 'Wrestler';
    else if (lc.includes('brazilian jiu-jitsu') || lc.includes('submission grappling')) style = 'Grappler';
    else if (lc.includes('kickboxing') || lc.includes('muay thai') || lc.includes('boxing')) style = 'Striker';

    let stance = 'Orthodox';
    if (lc.includes('southpaw')) stance = 'Southpaw';
    else if (lc.includes('switch stance') || lc.includes('switches stance')) stance = 'Switch';

    // ── Idade – todos os formatos possíveis ────────────────────────
    let age = null;
    const datePatterns = [
      /birth.?date[^=\n]*=\s*\{\{[^}]*?(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i,
      /birth.?date\s*=\s*(\d{4})-(\d{1,2})-(\d{1,2})/,
      /\{\{birth[_ ]date[^}]*?\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i,
      /born.*?(\d{4})-(\d{1,2})-(\d{1,2})/is,
      /birth.?date[^=]*=\s*([A-Z][a-z]+ \d{1,2},?\s*\d{4})/i,
      /birth.?date[^=]*=\s*(\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/i,
    ];
    for (const pat of datePatterns) {
      const m = content.match(pat);
      if (!m) continue;
      let d;
      if (m[2] && m[3]) {
        d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      } else {
        d = new Date(m[1]);
      }
      if (!isNaN(d)) {
        const now = new Date();
        let a = now.getFullYear() - d.getFullYear();
        const mo = now.getMonth() - d.getMonth();
        if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) a--;
        if (a > 10 && a < 65) { age = a; break; }
      }
    }

    // ── Cartel (Lógica Robusta Multi-Camada) ───────────────────────
    let wins = null, losses = null, draws = 0, nc = 0;
    let ko_wins = null, sub_wins = null, dec_wins = null;

    // TENTATIVA 1: Template {{MMArecordbox}} (Mais moderno/comum atualmente)
    const koW  = content.match(/\|\s*ko-wins\s*=\s*(\d+)/i);
    const subW = content.match(/\|\s*sub-wins\s*=\s*(\d+)/i);
    const decW = content.match(/\|\s*dec-wins\s*=\s*(\d+)/i);
    if (koW || subW || decW) {
      ko_wins  = parseInt(koW?.[1] || 0);
      sub_wins = parseInt(subW?.[1] || 0);
      dec_wins = parseInt(decW?.[1] || 0);
      const dqW  = parseInt(content.match(/\|\s*dq-wins\s*=\s*(\d+)/i)?.[1] || 0);
      const othW = parseInt(content.match(/\|\s*other-wins\s*=\s*(\d+)/i)?.[1] || 0);
      wins = ko_wins + sub_wins + dec_wins + dqW + othW;

      const koL  = parseInt(content.match(/\|\s*ko-losses\s*=\s*(\d+)/i)?.[1] || 0);
      const subL = parseInt(content.match(/\|\s*sub-losses\s*=\s*(\d+)/i)?.[1] || 0);
      const decL = parseInt(content.match(/\|\s*dec-losses\s*=\s*(\d+)/i)?.[1] || 0);
      const dqL  = parseInt(content.match(/\|\s*dq-losses\s*=\s*(\d+)/i)?.[1] || 0);
      const othL = parseInt(content.match(/\|\s*other-losses\s*=\s*(\d+)/i)?.[1] || 0);
      losses = koL + subL + decL + dqL + othL;

      draws = parseInt(content.match(/\|\s*draws\s*=\s*(\d+)/i)?.[1] || 0);
      nc    = parseInt(content.match(/\|\s*nc\s*=\s*(\d+)/i)?.[1] || 0);
    } 
    else {
      // TENTATIVA 2: Infobox antigo (wins/losses)
      const wM  = content.match(/\|\s*wins\s*=\s*(\d+)/i);
      const lM  = content.match(/\|\s*losses\s*=\s*(\d+)/i);
      if (wM) wins   = parseInt(wM[1]);
      if (lM) losses = parseInt(lM[1]);
      
      const dM  = content.match(/\|\s*draws\s*=\s*(\d+)/i);
      const ncM = content.match(/\|\s*nc\s*=\s*(\d+)/i);
      if (dM)  draws = parseInt(dM[1]);
      if (ncM) nc    = parseInt(ncM[1]);
      
      const kM = content.match(/\|\s*ko(?:s|_wins)?\s*=\s*(\d+)/i);
      const sM = content.match(/\|\s*sub(?:s|missions|_wins)?\s*=\s*(\d+)/i);
      const cM = content.match(/\|\s*dec(?:isions|_wins)?\s*=\s*(\d+)/i);
      if (kM) ko_wins  = parseInt(kM[1]);
      if (sM) sub_wins = parseInt(sM[1]);
      if (cM) dec_wins = parseInt(cM[1]);
    }

    // TENTATIVA 3: Contagem direta na tabela de lutas se ainda falhou
    if (wins === null || losses === null) {
      const cw = (content.match(/\|\s*Win\s*\|\|/gi) || []).length;
      const cl = (content.match(/\|\s*Loss\s*\|\|/gi) || []).length;
      if (cw > 0 || cl > 0) {
        wins = cw;
        losses = cl;
        draws = (content.match(/\|\s*Draw\s*\|\|/gi) || []).length;
        nc = (content.match(/\|\s*NC\s*\|\|/gi) || []).length;
      }
    }

    // ── Histórico de adversários ───────────────────────────────────
    const fight_history = [];
    // Captura linha padrão (Win/Loss) e extrai o nome e o método
    const oppMatches = [...content.matchAll(/\|\s*(?:style="[^"]*"\s*\|)?\s*(Win|Loss|Draw|NC)\s*\|\|\s*[\d–\-]+\s*\|\|\s*(?:\[\[)?([^\]|]+)(?:\|([^\]]+))?(?:\]\])?\s*\|\|\s*(?:\[\[)?([^\]|]+)/gi)];
    
    for (const m of oppMatches) {
      if (fight_history.length >= 6) break;
      const res = m[1].trim() === 'Win' ? 'W' : m[1].trim() === 'Loss' ? 'L' : 'D';
      let opp = (m[3] || m[2]).replace(/['"]/g, '').trim();
      let method = (m[4] || '').replace(/\[\[|\]\]/g, '').split('|').pop().trim();
      if (opp.length > 2 && opp.length < 60) {
        fight_history.push({ result: res, opponent: opp, method: method.substring(0, 40) });
      }
    }

    return { height_cm: height_cm || 0, reach_cm: reach_cm || 0, style, stance, age,
             wins, losses, draws, nc, ko_wins, sub_wins, dec_wins, fight_history, source: 'wikipedia' };
  } catch (e) {
    console.warn(`[Wikipedia] Erro:`, e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════════
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Nome não fornecido' });

  // ── Físico do DB local (instantâneo) ──────────────────────────────
  const dbResult   = lookupInDB(name);
  const hasPhysical = dbResult && (dbResult.height_cm > 0 || dbResult.reach_cm > 0);

  // ── Wikipedia: única fonte viável via Serverless ──────────────────
  let wiki = null;
  try {
    wiki = await lookupInWikipedia(name);
    if (wiki) console.log(`[Wikipedia] ${name}: ${wiki.wins ?? '?'}V-${wiki.losses ?? '?'}D | idade:${wiki.age ?? '?'}`);
  } catch (e) {
    console.warn(`[Wikipedia] Falhou:`, e.message);
  }

  if (hasPhysical) {
    // Mescla físico local com cartel da Wikipedia
    const merged = {
      ...dbResult,
      age:           wiki?.age           ?? null,
      wins:          wiki?.wins          ?? null,
      losses:        wiki?.losses        ?? null,
      draws:         wiki?.draws         ?? 0,
      nc:            wiki?.nc            ?? 0,
      ko_wins:       wiki?.ko_wins       ?? null,
      sub_wins:      wiki?.sub_wins      ?? null,
      dec_wins:      wiki?.dec_wins      ?? null,
      fight_history: wiki?.fight_history ?? [],
      stance: dbResult.stance || wiki?.stance || 'Orthodox',
      style:  dbResult.style  || wiki?.style  || 'All-Round',
      source: `local_db+wikipedia`,
    };
    return res.status(200).json(merged);
  }

  if (wiki && (wiki.height_cm > 0 || wiki.reach_cm > 0 || wiki.wins !== null)) {
    return res.status(200).json(wiki);
  }

  return res.status(404).json({ error: `Dados não encontrados para: ${name}` });
};

