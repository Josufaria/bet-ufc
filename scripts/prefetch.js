const fs = require('fs');
const path = require('path');
const axios = require('axios');

// API config
const SHEET_ID = '10YBrQnIKr8x3VG2qzO4jT0TJe5xOedOxQA0TKMc_1PE';
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY || '';
const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

// Database file paths
const NODE_DB_PATH = path.join(__dirname, '../api/fighters-db-node.js');
const CLIENT_DB_PATH = path.join(__dirname, '../js/fighters-db.js');

// Load existing DB
const FIGHTERS_DB = require(NODE_DB_PATH);

// Wikipedia Parser (exact same logic as api/get-fighter-stats.js)
const HEADERS = { 'User-Agent': 'UFCBetStats/1.0 (educational project)' };
const TIMEOUT = 8000;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
      let d = (m[2] && m[3]) ? new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])) : new Date(m[1]);
      if (!isNaN(d)) {
        const now = new Date();
        let a = now.getFullYear() - d.getFullYear();
        const mo = now.getMonth() - d.getMonth();
        if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) a--;
        if (a > 10 && a < 65) { age = a; break; }
      }
    }

    let wins = null, losses = null, draws = 0, nc = 0;
    let ko_wins = null, sub_wins = null, dec_wins = null;

    const koW = content.match(/\|\s*ko-wins\s*=\s*(\d+)/i);
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
    } else {
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

    if (wins === null || losses === null) {
      const cw = (content.match(/\|\s*Win\s*\|\|/gi) || []).length;
      const cl = (content.match(/\|\s*Loss\s*\|\|/gi) || []).length;
      if (cw > 0 || cl > 0) { wins = cw; losses = cl; }
    }

    const fight_history = [];
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

    return { age, wins, losses, draws, nc, ko_wins, sub_wins, dec_wins, fight_history };
  } catch (e) {
    return null;
  }
}

async function run() {
  console.log("Fetching Google Sheets metadata...");
  const metaUrl = `${BASE_URL}?fields=sheets(properties.title)&key=${API_KEY}`;
  const metaRes = await axios.get(metaUrl);
  const IGNORAR = ['🗃️ Lutadores','📊 Ref. Odds','🏆 Ranking','💰 Bankroll','📈 Evolução','🎯 Por Odds','🥊 Por Lutador'];
  const sheets = metaRes.data.sheets.map(s => s.properties.title).filter(n => !IGNORAR.includes(n)).slice(0, 5); // APENAS OS 5 PRÓXIMOS EVENTOS
  
  console.log(`Found ${sheets.length} active events. Fetching fighters...`);
  
  const fightersToScrape = new Set();
  
  // Batch get in chunks of 8
  const chunkSize = 8;
  for (let i = 0; i < sheets.length; i += chunkSize) {
    const chunk = sheets.slice(i, i + chunkSize);
    const qs = chunk.map(s => `ranges=${encodeURIComponent(s)}!A1:Z120`).join('&');
    const batchUrl = `${BASE_URL}/values:batchGet?${qs}&key=${API_KEY}`;
    const batch = await axios.get(batchUrl);
    
    (batch.data.valueRanges || []).forEach(vr => {
      const values = vr.values || [];
      // Usually fighters are in col A and C, or A and B depending on format. Let's grab all strings that look like names
      // Specifically checking row indices where fighters normally appear.
      // Easiest way: look at columns A (Lutador 1) and C (Lutador 2) from row 3 downwards
      for (let r = 2; r < values.length; r++) {
        const row = values[r];
        if (!row || row.length < 2) continue;
        const f1 = row[0]?.trim();
        const f2 = row[2]?.trim() || row[1]?.trim(); // sometimes C, sometimes B
        
        if (f1 && f1.includes(' ')) fightersToScrape.add(f1.toLowerCase());
        if (f2 && f2.includes(' ')) fightersToScrape.add(f2.toLowerCase());
      }
    });
  }

  console.log(`Extracted ${fightersToScrape.size} total unique fighter names from all events.`);
  
  // Filter fighters that don't have cartel info in DB
  const missing = [];
  for (const name of fightersToScrape) {
    if (name === 'luta' || name === 'lutador 1' || name === 'lutador 2' || name === 'vencedor') continue;
    const db = FIGHTERS_DB[name] || Object.values(FIGHTERS_DB).find(f => f.name && f.name.toLowerCase() === name);
    if (!db || db.wins === undefined || db.age === undefined) {
      missing.push(name);
    }
  }

  console.log(`Need to scrape ${missing.length} fighters from Wikipedia...`);
  
  let updated = 0;
  for (let i = 0; i < missing.length; i++) {
    const name = missing[i];
    console.log(`[${i+1}/${missing.length}] Scraping: ${name}`);
    
    const wiki = await lookupInWikipedia(name);
    if (wiki && wiki.wins !== null && wiki.wins !== undefined) {
      // Ensure the entry exists in DB
      if (!FIGHTERS_DB[name]) FIGHTERS_DB[name] = { height_cm: 0, reach_cm: 0, stance: "Orthodox", style: "All-Round" };
      
      // Merge
      Object.assign(FIGHTERS_DB[name], wiki);
      console.log(`  -> Salvo! ${wiki.wins}V-${wiki.losses}D (${wiki.age} anos)`);
      updated++;
    } else {
      console.log(`  -> Não encontrado ou sem cartel na Wiki.`);
    }
    
    await sleep(1500); // polite delay
  }

  if (updated > 0) {
    console.log(`Writing updated DB to disk (${updated} novos registros preenchidos)...`);
    
    // Build node version
    const nodeStr = `// Banco de dados de lutadores UFC para uso no backend (Node.js)\n// Atualizado via scripts/prefetch.js\n\nconst FIGHTERS_DB = ${JSON.stringify(FIGHTERS_DB, null, 2)};\n\nmodule.exports = FIGHTERS_DB;\n`;
    fs.writeFileSync(NODE_DB_PATH, nodeStr, 'utf8');

    // Build client version
    // Client version requires a different header
    const clientStr = `// Banco de Dados Local Estático - Lutadores UFC\n// Atualizado via scripts/prefetch.js\n\nconst FIGHTERS_DB = ${JSON.stringify(FIGHTERS_DB, null, 2)};\n\nfunction getFighterData(name) {\n  if (!name) return null;\n  let nl = name.toLowerCase().trim();\n  const ALIASES = { "torres": "manuel torres", "fiziev": "rafael fiziev", "makhachev": "islam makhachev", "machado garry": "ian machado garry", "ankalaev": "magomed ankalaev", "rountree jr.": "khalil rountree jr", "medic": "uros medic", "rodriguez": "daniel rodriguez" };\n  if (ALIASES[nl]) nl = ALIASES[nl];\n  const searchIn = (db) => {\n    if (db[nl]) return { ...db[nl], name };\n    const words = nl.split(/\\s+/).filter(w => w.length > 2);\n    let best = null;\n    for (const w of words) if (db[w]) return { ...db[w], name };\n    for (const [k, d] of Object.entries(db)) {\n      if (k.includes(nl) || nl.includes(k)) if (!best || (best.reach_cm === 0 && d.reach_cm > 0)) best = { ...d, name };\n      const kw = k.split(/\\s+/);\n      if (words.some(w => kw.includes(w))) if (!best || (best.reach_cm === 0 && d.reach_cm > 0)) best = { ...d, name };\n    }\n    return best;\n  };\n  const custom = (typeof getCustomFighters === "function") ? getCustomFighters() : {};\n  const found = searchIn(custom);\n  if (found) return found;\n  return searchIn(FIGHTERS_DB);\n}\n\nfunction getCustomFighters() { try { const custom = localStorage.getItem('custom_fighters_db'); return custom ? JSON.parse(custom) : {}; } catch (e) { return {}; } }\nfunction saveCustomFighter(name, data) { if (!name || !data) return; const custom = getCustomFighters(); custom[name.toLowerCase().trim()] = data; localStorage.setItem('custom_fighters_db', JSON.stringify(custom)); }\n`;
    fs.writeFileSync(CLIENT_DB_PATH, clientStr, 'utf8');

    console.log("Success! DB updated on both frontend and backend.");
  } else {
    console.log("Nenhum lutador novo precisava de atualização.");
  }
}

run().catch(console.error);
