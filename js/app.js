/**
 * 🥊 UFC BET ANALYZER — LÓGICA PRINCIPAL
 *
 * Configuração:
 *   SHEET_ID  → ID da sua planilha Google Sheets (parte da URL)
 *   API_KEY   → Chave gratuita da Google Sheets API
 *
 * Como obter sua API Key GRATUITAMENTE:
 *   1. Acesse: https://console.cloud.google.com/
 *   2. Crie um projeto (ex: "UFC Analyzer")
 *   3. Ative a "Google Sheets API" em APIs & Serviços
 *   4. Vá em "Credenciais" → "Criar credenciais" → "Chave de API"
 *   5. Copie a chave e cole abaixo (ou use o botão ⚙️ no site)
 *
 * Como deixar a planilha pública:
 *   Sheets → Compartilhar → Qualquer pessoa com o link → Visualizador
 */

// ── CONFIGURAÇÃO ────────────────────────────────────────────────
// Forçar a migração de cache do localStorage para a nova planilha com 96 abas corretas do usuário
if (!localStorage.getItem('ufc_sheet_migrated_v5')) {
  localStorage.setItem('ufc_sheet_id', '10YBrQnIKr8x3VG2qzO4jT0TJe5xOedOxQA0TKMc_1PE');
  localStorage.setItem('ufc_sheet_migrated_v5', 'true');
}

let CFG = {
  SHEET_ID: localStorage.getItem('ufc_sheet_id') || '10YBrQnIKr8x3VG2qzO4jT0TJe5xOedOxQA0TKMc_1PE',
};

const BASE = () => `/api/sheets-proxy`;
const IGNORAR = ['🗃️ Lutadores','📊 Ref. Odds','🏆 Ranking','💰 Bankroll','📈 Evolução','🎯 Por Odds','🥊 Por Lutador'];
const NULO    = ['NC','NO CONTEST','DRAW','EMPATE','SEM CONTEST'];

// ── ESTADO GLOBAL ────────────────────────────────────────────────
let _eventos   = [];
let _lutadores = {};
let _tipsters  = [];
let _zebraStats = {};
let _currentTab = 'futuros';

// Fila Inteligente ESPN (Garante que a fila não será reescrita a cada renderização)
window._espnQueue = [];
window._espnProcessing = false;
window._fetchingEspn = {};
window._processEspnQueue = async function() {
  if (window._espnProcessing || window._espnQueue.length === 0) return;
  window._espnProcessing = true;

  const batch = [...new Set(window._espnQueue.splice(0, window._espnQueue.length))];
  
  try {
    console.log(`[ESPN Queue] Buscando lote em paralelo: ${batch.join(', ')}`);
    
    await Promise.allSettled(batch.map(async (fighter) => {
      try {
        const r = await fetch(`/api/get-fighter-espn?name=${encodeURIComponent(fighter)}`);
        if (r.ok) {
           const data = await r.json();
           if (data.success) {
              if (typeof saveCustomFighter === 'function') {
                const existingDb = typeof getFighterData === 'function' ? getFighterData(fighter) : {};
                saveCustomFighter(fighter, {
                  ...existingDb,
                  height_cm: data.height_cm || existingDb.height_cm,
                  reach_cm: data.reach_cm || existingDb.reach_cm,
                  stance: data.stance || existingDb.stance,
                  wins: data.wins !== null ? data.wins : existingDb.wins,
                  losses: data.losses !== null ? data.losses : existingDb.losses,
                  draws: data.draws !== null ? data.draws : existingDb.draws,
                  espn_photo: data.photo,
                  not_found_espn: false,
                  espn_sync_done: true
                });
                window._fetchingEspn[fighter] = false;
                if (typeof refreshFighterCards === 'function') {
                   refreshFighterCards(fighter);
                }
              }
           } else {
             window._fetchingEspn[fighter] = false;
           }
        } else if (r.status === 404) {
           window._fetchingEspn[fighter] = 'not_found';
           if (typeof saveCustomFighter === 'function') {
             const existingDb = typeof getFighterData === 'function' ? getFighterData(fighter) : {};
             saveCustomFighter(fighter, { ...existingDb, not_found_espn: true });
           }
        }
      } catch (e) {
        console.error("[ESPN Queue] Erro individual para", fighter, e);
        window._fetchingEspn[fighter] = false;
      }
    }));
  } catch (e) {
    console.error("[ESPN Queue] Erro ao processar lote", e);
  } finally {
    window._espnProcessing = false;
    if (window._espnQueue.length > 0) {
      window._processEspnQueue();
    }
  }
};

// Charts
let _roiChart = null, _compareChart = null, _styleChart = null;

// ── API HELPERS ──────────────────────────────────────────────────
async function api(path) {
  const url = `/api/sheets-proxy?path=${encodeURIComponent(path)}`;
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${t.substring(0, 300)}`);
  }
  return r.json();
}

async function batchGetChunked(sheets, size = 8) {
  const all = [];
  for (let i = 0; i < sheets.length; i += size) {
    const chunk = sheets.slice(i, i + size);
    const qs = chunk.map(s => `ranges=${encodeURIComponent(s)}!A1:Z120`).join('&');
    const batch = await api(`/values:batchGet?${qs}`);
    (batch.valueRanges || []).forEach((vr, j) => all.push({ nome: chunk[j], values: vr.values || [] }));
  }
  return all;
}

// ── CARREGAMENTO ─────────────────────────────────────────────────
async function loadData() {
  const loadEl = document.getElementById('loading');
  try {
    loadEl.innerHTML = '<div class="spinner"></div>Buscando abas da planilha…';

    const meta = await api('?fields=sheets(properties.title)');
    const all = (meta.sheets || []).map(s => s.properties.title);
    const sheets = all.filter(n => !IGNORAR.includes(n));

    loadEl.innerHTML = `<div class="spinner"></div>Carregando ${sheets.length} eventos…`;

    // Tipsters
    try {
      const cfg = await api('/values/' + encodeURIComponent('📊 Ref. Odds!H2:H3'));
      const vals = (cfg.values || []);
      _tipsters = JSON.parse(vals[1]?.[0] || '[]');
    } catch (e) { console.warn('Tipsters:', e); }

    // Lutadores (estilo)
    const lutTab = all.find(n => n.includes('Lutadores'));
    if (lutTab) {
      try {
        const lr = await api(`/values/${encodeURIComponent(lutTab)}!A1:H500`);
        parseLutadores(lr.values || []);
      } catch (e) { console.warn('Lutadores:', e); }
    }

    if (!sheets.length) { renderEmpty(); return; }

    const evData = await batchGetChunked(sheets);
    evData.forEach(({ nome, values }) => parseEvento(nome, values));

    // ── INTEGRAÇÃO ESPN (Eventos Futuros) ──
    try {
      loadEl.innerHTML = `<div class="spinner"></div>Sincronizando API ESPN em tempo real…`;
      const espnRes = await Promise.race([
        fetch('/api/get-espn-events'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('ESPN timeout')), 5000))
      ]);
      if (espnRes.ok) {
        const espnJson = await espnRes.json();
        if (espnJson.success && espnJson.events) {
          integrateEspnEvents(espnJson.events);
        }
      }
    } catch (err) {
      console.warn("Falha ao carregar API da ESPN:", err);
    }

    // Pré-calcular stats de zebra
    _zebraStats = computeOddsCatsGeral();

    renderAll();
  } catch (e) {
    console.error('loadData:', e);
    // Fallback elegante para dados locais offline (UFC 299, 300 e 301)
    loadDemoData();
    showDemoWarning(e.message);
    renderAll();
  }
}

// ── INTEGRAÇÃO ESPN ───────────────────────────────────────────────
function integrateEspnEvents(espnEvents) {
  espnEvents.forEach(espnEv => {
    const cardLutas = [];
    const oddCard = {};
    
    espnEv.fights.forEach(fight => {
      if (!fight.fighters || fight.fighters.length < 2) return;
      const f1 = fight.fighters[0];
      const f2 = fight.fighters[1];
      
      cardLutas.push({
        fV: f1.name,
        oV: null,
        f1Obj: f1, // Guardando o objeto inteiro para injetar fotos e cartel depois
        espnPhotoV: f1.photo,
        fA: f2.name,
        oA: null,
        f2Obj: f2,
        espnPhotoA: f2.photo,
        espnOdds: fight.odds ? fight.odds.details : null
      });
    });

    // Inverter a ordem para que a luta principal (primeira da ESPN) fique por último no card
    cardLutas.reverse();

    const evObj = {
      nome: espnEv.name, // Nome oficial do evento
      dataEvento: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(espnEv.date)),
      cardLutas: cardLutas,
      oddCard: oddCard,
      lutas: [],
      punterAnalise: [],
      apostas: null,
      concluido: false,
      isEspn: true
    };
    // Evita duplicidade e mescla com a planilha (mantendo análises se houver)
    const baseName = espnEv.name.split(':')[0].trim().toLowerCase(); // ex: "UFC 306"
    const existingIdx = _eventos.findIndex(e => e.nome.toLowerCase().includes(baseName));
    
    if (existingIdx >= 0) {
      const sheetLutas = _eventos[existingIdx].cardLutas || [];
      cardLutas.forEach(espnLuta => {
        const fVLast = espnLuta.fV.toLowerCase().split(' ').pop();
        const fALast = espnLuta.fA.toLowerCase().split(' ').pop();
        
        const sl = sheetLutas.find(l => 
          (l.fV && l.fV.toLowerCase().includes(fVLast)) || 
          (l.fA && l.fA.toLowerCase().includes(fALast))
        );
        
        if (sl) {
          if (sl.fV && sl.fV.toLowerCase().includes(fVLast)) {
            espnLuta.oV = sl.oV;
            espnLuta.oA = sl.oA;
          } else {
            espnLuta.oV = sl.oA;
            espnLuta.oA = sl.oV;
          }
        }
      });

      _eventos[existingIdx].cardLutas = cardLutas;
      _eventos[existingIdx].isEspn = true;
      if (!_eventos[existingIdx].dataEvento) _eventos[existingIdx].dataEvento = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(espnEv.date));
    } else {
      _eventos.unshift(evObj);
    }
  });
}

// ── PARSE LUTADORES ───────────────────────────────────────────────
function parseLutadores(rows) {
  for (let i = 2; i < rows.length; i++) {
    const name  = String(rows[i][0] || '').trim().toLowerCase();
    const style = String(rows[i][1] || '').trim();
    if (!name || !style) continue;
    _lutadores[name] = style;
    const last = name.split(' ').pop();
    if (last.length > 3) _lutadores[last] = style;
  }
}

// ── PARSE EVENTO ─────────────────────────────────────────────────
function parseEvento(nome, d) {
  if (!d || !d.length) return;
  const dataEvento = String(d[0]?.[0] || '');

  const cardLutas = [], oddCard = {};
  const lutas = [];
  const punterAnalise = [];
  let apostas = null;

  let r = 0;
  while (r < d.length) {
    const row = d[r] || [];
    const firstCell = String(row[0] || '').trim().toUpperCase();
    const secondCell = String(row[1] || '').trim().toUpperCase();

    // 1. CARD DE LUTAS
    if (firstCell.includes('CARD DE LUTAS')) {
      r++; // Pular o título
      // Pular cabeçalhos se houver (Lutador V, Odd V...)
      if (r < d.length && String(d[r]?.[0] || '').includes('Lutador')) r++;
      
      while (r < d.length) {
        const cRow = d[r] || [];
        const fV = String(cRow[0] || '').trim();
        const fA = String(cRow[4] || '').trim();
        
        // Se a linha estiver vazia ou começar outra seção (como RESULTADO REAL), sair deste loop
        if (!fV && !fA) break;
        if (fV.toUpperCase().includes('RESULTADO') || String(cRow[1] || '').toUpperCase().includes('RESULTADO')) break;
        if (fV.toUpperCase() === 'LUTA') break;

        const oV = parseFloat(String(cRow[1] || '').replace(',', '.'));
        const oA = parseFloat(String(cRow[3] || '').replace(',', '.'));

        if (fV && !isNaN(oV)) oddCard[fV.toLowerCase()] = oV;
        if (fA && !isNaN(oA)) oddCard[fA.toLowerCase()] = oA;
        cardLutas.push({ fV, oV: isNaN(oV) ? null : oV, fA, oA: isNaN(oA) ? null : oA });
        r++;
      }
      continue;
    }

    // 2. RESULTADO REAL
    if (firstCell.includes('RESULTADO REAL') || secondCell.includes('RESULTADO REAL')) {
      r++; // Pular título
      const hdr = d[r] || [];
      const tipCol = {};
      _tipsters.forEach(t => {
        const ci = hdr.findIndex(c => String(c).trim() === t.trim());
        if (ci >= 0) tipCol[t] = ci;
      });
      r++; // Pular cabeçalho
      
      while (r < d.length) {
        const rRow = d[r] || [];
        const luta = String(rRow[0] || '').trim();
        if (!luta || luta.toUpperCase().includes('PUNTERMIND')) break;
        if (luta.toUpperCase().includes('ACERTOS') || luta.toUpperCase().includes('% ACERTO')) break;

        const resultado = String(rRow[1] || '').trim();
        const picks = {};
        _tipsters.forEach(t => { if (tipCol[t] !== undefined) picks[t] = String(rRow[tipCol[t]] || '').trim(); });
        
        lutas.push({ luta, resultado, metReal: String(rRow[2] || '').trim(), picks });
        r++;
      }
      continue;
    }

    // 3. PUNTERMIND ANÁLISE PROFUNDA
    if (firstCell.includes('PUNTERMIND') || secondCell.includes('PUNTERMIND')) {
      r++; // Pular título
      // Pular cabeçalho se houver (Luta, Fisico/Matchup)
      if (r < d.length && String(d[r]?.[0] || '').includes('Luta')) r++;

      while (r < d.length) {
        const pRow = d[r] || [];
        const luta = String(pRow[0] || '').trim();
        if (!luta || luta.toUpperCase().includes('APOSTAS')) break;
        if (luta.toUpperCase() === 'TIPO') break;

        const evStr = String(pRow[4] || '').trim() || String(pRow[3] || '').trim(); // Fallback dependendo da coluna
        const pick = String(pRow[5] || '').trim() || String(pRow[4] || '').trim();
        
        punterAnalise.push({
          luta,
          fisico:   String(pRow[1] || '').trim(),
          probImp:  String(pRow[2] || '').trim(),
          probReal: String(pRow[3] || '').trim(),
          ev: evStr,
          pick,
          met:  String(pRow[6] || '').trim(),
          nota: String(pRow[7] || '').trim()
        });
        r++;
      }
      continue;
    }

    // 4. APOSTAS SUGERIDAS
    if (firstCell.includes('APOSTAS SUGERIDAS') || secondCell.includes('MELHORES APOSTAS') || firstCell.includes('MELHORES APOSTAS')) {
      r++; // Pular título
      if (r < d.length && String(d[r]?.[0] || '').toUpperCase().includes('TIPO')) r++;
      
      const s = d[r] || [], db = d[r + 1] || [], tr = d[r + 2] || [];
      const hasReal = (s[1] && s[1] !== 'Melhor pick EV+ da noite') || db[1] || tr[1];
      const sanitizeOdd = (val) => {
        let v = String(val).trim();
        if (v.endsWith('%')) {
          const num = parseFloat(v.replace('%', ''));
          if (!isNaN(num)) return (num / 100).toFixed(2);
        }
        if (/^0\d\.\d+$/.test(v)) return parseFloat(v).toFixed(2); // Fix "03.04" -> "3.04"
        const num = parseFloat(v.replace(',', '.'));
        if (!isNaN(num) && num > 0) return num.toFixed(2);
        return v;
      };

      if (hasReal) {
        apostas = {
          simples: { tipo: String(s[0] || ''), selecao: String(s[1] || ''), odd: sanitizeOdd(s[2]), nota: String(s[3] || '') },
          dupla:   { tipo: String(db[0] || ''), selecao: String(db[1] || ''), odd: sanitizeOdd(db[2]), nota: String(db[3] || '') },
          tripla:  { tipo: String(tr[0] || ''), selecao: String(tr[1] || ''), odd: sanitizeOdd(tr[2]), nota: String(tr[3] || '') },
        };
      }
      r += 3;
      continue;
    }

    r++;
  }

  const evObj = { nome, dataEvento, cardLutas, lutas, punterAnalise, apostas, oddCard };
  
  // Determina se é evento futuro validando se nenhuma luta possui um resultado válido
  const validResults = evObj.lutas.filter(l => l.resultado && l.resultado.trim() !== '' && l.resultado.trim() !== '?');
  evObj.isFuturo = evObj.lutas.length === 0 || validResults.length === 0;
  
  _eventos.push(evObj);
}

// ── HELPERS ──────────────────────────────────────────────────────
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function getLutStyle(name) {
  if (!name) return null;
  const nl = name.toLowerCase();
  if (_lutadores[nl]) return _lutadores[nl];
  const last = nl.split(' ').pop();
  return (last.length > 3 && _lutadores[last]) || null;
}

function getStyleCat(s) {
  if (!s) return null;
  const sl = s.toLowerCase();
  if (sl === 'striker') return 'Striker';
  if (sl === 'all-round' || sl === 'all round') return 'All-Round';
  if (sl === 'wrestler') return 'Wrestler';
  return 'Grappler';
}

function findLuta(ev, fighterName) {
  if (!fighterName) return null;
  const tokens = fighterName.toLowerCase().split(' ').filter(p => p.length > 3);
  return ev.lutas.find(l => {
    const ll = l.luta.toLowerCase();
    return tokens.some(p => ll.includes(p));
  }) || null;
}

function findOdds(oddCard, fighterName) {
  if (!fighterName) return null;
  const fl = fighterName.toLowerCase();
  const tokens = fl.split(' ').filter(p => p.length > 3);
  const key = Object.keys(oddCard).find(k => k === fl || tokens.some(t => k.includes(t) || t.includes(k.split(' ').pop())));
  return key ? oddCard[key] : null;
}

// ── ODDS CATS ─────────────────────────────────────────────────────
function computeOddsCatsGeral() {
  const stats = {};
  ODDS_CATS.forEach(c => { stats[c.key] = { picks: 0, acertos: 0, roi: 0 }; });
  _eventos.forEach(ev => {
    ev.lutas.forEach(luta => {
      if (!luta.resultado || !luta.luta) return;
      if (NULO.some(x => luta.resultado.toUpperCase().includes(x))) return;
      const parts = luta.luta.split(/\s+VS\s+/i);
      if (parts.length < 2) return;
      [parts[0].trim(), parts[1].trim()].forEach(fighter => {
        const odds = findOdds(ev.oddCard, fighter);
        if (!odds) return;
        const cat = getOddsCat(odds);
        if (!cat) return;
        const pickL = fighter.toLowerCase().split(' ').pop();
        const acertou = luta.resultado.toLowerCase().includes(pickL);
        stats[cat.key].picks++;
        stats[cat.key].roi += acertou ? (odds - 1) : -1;
        if (acertou) stats[cat.key].acertos++;
      });
    });
  });
  return stats;
}

function computeOddsCatsPick() {
  const stats = {};
  ODDS_CATS.forEach(c => { stats[c.key] = { picks: 0, acertos: 0, roi: 0 }; });
  _eventos.forEach(ev => {
    (ev.cardLutas || []).forEach(c => {
      [[c.fV, c.oV], [c.fA, c.oA]].forEach(([name, odds]) => {
        if (!name || !odds || odds <= 1.0 || odds > 20) return;
        const cat = getOddsCat(odds);
        if (!cat) return;
        const pickL = name.toLowerCase().split(' ').pop();
        const luta = ev.lutas.find(l => l.luta.toLowerCase().includes(pickL));
        if (!luta || !luta.resultado) return;
        if (NULO.some(x => luta.resultado.toUpperCase().includes(x))) return;
        stats[cat.key].picks++;
        const acertou = luta.resultado.toLowerCase().includes(pickL);
        stats[cat.key].roi += acertou ? (odds - 1) : -1;
        if (acertou) stats[cat.key].acertos++;
      });
    });
  });
  return stats;
}

// ── COMPUTE STATS ─────────────────────────────────────────────────
function computeStats() {
  let pmPicks=0,pmAcertos=0,pmROI=0;
  let lockPicks=0,lockAcertos=0,lockROI=0;
  let favPicks=0,favAcertos=0,favROI=0;
  let zebraPicks=0,zebraAcertos=0,zebraROI=0;
  const pmH=[], lockH=[], favH=[], zebH=[];

  _eventos.forEach(ev => {
    ev.punterAnalise.forEach(pm => {
      if (!pm.pick) return;
      const luta = findLuta(ev, pm.pick);
      if (!luta || !luta.resultado) return;
      if (NULO.some(x => luta.resultado.toUpperCase().includes(x))) return;
      const odds = findOdds(ev.oddCard, pm.pick);
      if (!odds) return;
      pmPicks++;
      const pickL = pm.pick.toLowerCase().split(' ').pop();
      const acertou = luta.resultado.toLowerCase().includes(pickL);
      pmROI += acertou ? (odds - 1) : -1;
      if (acertou) pmAcertos++;
    });
    pmH.push({ nome: ev.nome, cum: +pmROI.toFixed(2) });

    ev.lutas.forEach(luta => {
      if (!luta.resultado || !luta.picks) return;
      if (NULO.some(x => luta.resultado.toUpperCase().includes(x))) return;
      const allPicks = Object.values(luta.picks).filter(p => p);
      if (!allPicks.length) return;
      const topPick = allPicks[0];
      const isLocker = allPicks.every(p => p.toLowerCase() === topPick.toLowerCase());
      if (!isLocker) return;
      const odds = findOdds(ev.oddCard, topPick);
      if (!odds) return;
      lockPicks++;
      const pickL = topPick.toLowerCase().split(' ').pop();
      const acertou = luta.resultado.toLowerCase().includes(pickL) ||
                      topPick.toLowerCase().includes(luta.resultado.toLowerCase());
      lockROI += acertou ? (odds - 1) : -1;
      if (acertou) lockAcertos++;
    });
    lockH.push({ nome: ev.nome, cum: +lockROI.toFixed(2) });

    (ev.cardLutas || []).forEach(c => {
      const favV = c.oV && c.oV < 1.35 && c.oV > 1.01;
      const favA = c.oA && c.oA < 1.35 && c.oA > 1.01;
      if (!favV && !favA) return;
      const fav = favV ? { name: c.fV, odds: c.oV } : { name: c.fA, odds: c.oA };
      const pickL = fav.name.toLowerCase().split(' ').pop();
      const luta = ev.lutas.find(l => l.luta.toLowerCase().includes(pickL));
      if (!luta || !luta.resultado) return;
      if (NULO.some(x => luta.resultado.toUpperCase().includes(x))) return;
      favPicks++;
      const acertou = luta.resultado.toLowerCase().includes(pickL);
      favROI += acertou ? (fav.odds - 1) : -1;
      if (acertou) favAcertos++;
    });
    favH.push({ nome: ev.nome, cum: +favROI.toFixed(2) });

    (ev.cardLutas || []).forEach(c => {
      let zeb = null;
      if (c.oV && c.oA && c.oV > 1.01 && c.oA > 1.01) {
        if (c.oV >= 2.50 && c.oV > c.oA) zeb = { name: c.fV, odds: c.oV };
        else if (c.oA >= 2.50 && c.oA > c.oV) zeb = { name: c.fA, odds: c.oA };
      }
      if (!zeb) return;
      const pickL = zeb.name.toLowerCase().split(' ').pop();
      const luta = ev.lutas.find(l => l.luta.toLowerCase().includes(pickL));
      if (!luta || !luta.resultado) return;
      if (NULO.some(x => luta.resultado.toUpperCase().includes(x))) return;
      zebraPicks++;
      const acertou = luta.resultado.toLowerCase().includes(pickL);
      zebraROI += acertou ? (zeb.odds - 1) : -1;
      if (acertou) zebraAcertos++;
    });
    zebH.push({ nome: ev.nome, cum: +zebraROI.toFixed(2) });
  });

  const pct = (roi, n) => n > 0 ? (roi / n * 100).toFixed(1) : '—';
  return {
    pmPicks, pmAcertos, pmROI: pmROI.toFixed(2), pmROIPct: pct(pmROI, pmPicks),
    hitRate: pmPicks > 0 ? (pmAcertos / pmPicks * 100).toFixed(1) : '—',
    lockPicks, lockAcertos, lockROI: lockROI.toFixed(2), lockROIPct: pct(lockROI, lockPicks),
    favPicks, favAcertos, favROI: favROI.toFixed(2), favROIPct: pct(favROI, favPicks),
    zebraPicks, zebraAcertos, zebraROI: zebraROI.toFixed(2), zebraROIPct: pct(zebraROI, zebraPicks),
    pmH, lockH, favH, zebH,
  };
}

function computeStyleStats() {
  const matchups = {};
  _eventos.forEach(ev => {
    (ev.cardLutas || []).forEach(c => {
      if (!c.fV || !c.fA) return;
      const catV = getStyleCat(getLutStyle(c.fV)), catA = getStyleCat(getLutStyle(c.fA));
      if (!catV || !catA) return;
      const pickLV = c.fV.toLowerCase().split(' ').pop(), pickLA = c.fA.toLowerCase().split(' ').pop();
      const luta = ev.lutas.find(l => l.luta.toLowerCase().includes(pickLV) || l.luta.toLowerCase().includes(pickLA));
      if (!luta || !luta.resultado) return;
      if (NULO.some(x => luta.resultado.toUpperCase().includes(x))) return;
      if (catV === catA) return;
      const key = [catV, catA].sort().join(' vs ');
      if (!matchups[key]) matchups[key] = { total: 0, wins: {} };
      matchups[key].total++;
      const winCat = luta.resultado.toLowerCase().includes(pickLV) ? catV : catA;
      matchups[key].wins[winCat] = (matchups[key].wins[winCat] || 0) + 1;
    });
  });
  return matchups;
}

// ── ALL PICKS ─────────────────────────────────────────────────────
function pickGanhou(ev, nome) {
  if (!nome) return null;
  const nl = nome.toLowerCase().trim();
  const words = nl.split(' ').filter(w => w.length > 2);
  const luta = ev.lutas.find(l => words.some(w => l.luta.toLowerCase().includes(w)));
  if (!luta || !luta.resultado) return null;
  const rl = luta.resultado.toLowerCase();
  return words.some(w => rl.includes(w));
}

function computeApostasROI() {
  let sROI=0,sP=0,sA=0;
  let dROI=0,dP=0,dA=0;
  let tROI=0,tP=0,tA=0;
  const sH=[],dH=[],tH=[];
  _eventos.forEach(ev => {
    const ap = ev.apostas;
    if (!ap) { sH.push({nome:ev.nome,cum:+sROI.toFixed(2)}); dH.push({nome:ev.nome,cum:+dROI.toFixed(2)}); tH.push({nome:ev.nome,cum:+tROI.toFixed(2)}); return; }
    if (ap.simples.selecao) {
      const odd = parseFloat(ap.simples.odd);
      if (odd > 1) { const g = pickGanhou(ev, ap.simples.selecao); if (g !== null) { sP++; if (g) { sROI += (odd-1); sA++; } else sROI -= 1; } }
    }
    sH.push({ nome: ev.nome, cum: +sROI.toFixed(2) });
    if (ap.dupla.selecao) {
      const odd = parseFloat(ap.dupla.odd);
      const picks = ap.dupla.selecao.split('+').map(p => p.trim()).filter(Boolean);
      if (odd > 1 && picks.length >= 2) { const res = picks.map(p => pickGanhou(ev, p)); if (!res.includes(null)) { dP++; const g = res.every(r => r===true); if (g) { dROI += (odd-1); dA++; } else dROI -= 1; } }
    }
    dH.push({ nome: ev.nome, cum: +dROI.toFixed(2) });
    if (ap.tripla.selecao) {
      const odd = parseFloat(ap.tripla.odd);
      const picks = ap.tripla.selecao.split('+').map(p => p.trim()).filter(Boolean);
      if (odd > 1 && picks.length >= 2) { const res = picks.map(p => pickGanhou(ev, p)); if (!res.includes(null)) { tP++; const g = res.every(r => r===true); if (g) { tROI += (odd-1); tA++; } else tROI -= 1; } }
    }
    tH.push({ nome: ev.nome, cum: +tROI.toFixed(2) });
  });
  return { sROI: +sROI.toFixed(2), sP, sA, sH, dROI: +dROI.toFixed(2), dP, dA, dH, tROI: +tROI.toFixed(2), tP, tA, tH };
}

// ── RENDER ALL ────────────────────────────────────────────────────
function renderAll() {
  const loadingEl = document.getElementById('loading');
  if (loadingEl) {
    loadingEl.hidden = true;
    loadingEl.style.display = 'none';
  }
  const mainEl = document.getElementById('main-content');
  if (mainEl) mainEl.hidden = false;

  switchTab(_currentTab);

  const stats = computeStats();
  renderKPIs(stats);
  renderPerfStats(stats);
  // renderROIChart moved to switchTab
  renderROICompare(stats);
  renderApostasROI();
  renderAllPicks();
  // renderCompareChart moved to switchTab
  renderOddsCats();
  renderOddsCatsGeral();
  // renderStyleStats moved to switchTab
}

function renderEmpty() {
  document.getElementById('loading').innerHTML = '<div class="empty"><div class="empty-icon">📭</div>Nenhum evento encontrado na planilha.</div>';
}

// ── KPIs ─────────────────────────────────────────────────────────
function renderKPIs(s) {
  const animateCount = (el, target, suffix = '') => {
    const start = 0;
    const duration = 1200;
    const startTime = performance.now();
    const isFloat = String(target).includes('.');
    const update = (now) => {
      const elapsed = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      const val = isFloat ? (start + (target - start) * eased).toFixed(2) : Math.round(start + (target - start) * eased);
      el.textContent = val + suffix;
      if (elapsed < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  };

  const acertosEl = document.getElementById('kpi-acertos');
  const eventsEl = document.getElementById('kpi-events');

  if (acertosEl) {
    const erros = s.pmPicks - s.pmAcertos;
    const pct = s.hitRate !== '—' ? s.hitRate + '%' : '-';
    acertosEl.innerHTML = `<span style="color:var(--green)">${s.pmAcertos}</span> / <span style="color:var(--red)">${erros}</span> <span style="font-size:0.6em; color:var(--text2); margin-left: 8px;">(${pct})</span>`;
  }

  if (eventsEl) {
    animateCount(eventsEl, _eventos.length || 0);
  }
}

// ── PERFORMANCE STATS ─────────────────────────────────────────────
function renderPerfStats(s) {
  const roi = parseFloat(s.pmROI), hit = parseFloat(s.hitRate);
  document.getElementById('perf-stats').innerHTML = `
    <div class="stat-card"><div class="stat-val ${hit >= 60 ? 'green' : hit < 45 ? 'red' : ''}">${s.hitRate !== '—' ? s.hitRate + '%' : '—'}</div><div class="stat-lbl">Hit Rate Geral</div></div>
    <div class="stat-card"><div class="stat-val ${roi > 0 ? 'green' : roi < 0 ? 'red' : 'cyan'}">${roi >= 0 ? '+' : ''}${s.pmROI}u</div><div class="stat-lbl">ROI Acumulado</div></div>
    <div class="stat-card"><div class="stat-val cyan">${s.pmAcertos}</div><div class="stat-lbl">Acertos</div></div>
    <div class="stat-card"><div class="stat-val red">${s.pmPicks - s.pmAcertos}</div><div class="stat-lbl">Erros</div></div>
    <div class="stat-card"><div class="stat-val purple">${s.pmPicks}</div><div class="stat-lbl">Total de Picks</div></div>
    <div class="stat-card"><div class="stat-val orange">${_eventos.filter(e => e.punterAnalise.length > 0).length}</div><div class="stat-lbl">Eventos Analisados</div></div>`;
}

// ── CHARTS ────────────────────────────────────────────────────────
const CHART_DEFAULTS = {
  x: { ticks: { color: '#4a5a78', font: { size: 10, family: 'Inter' } }, grid: { color: 'rgba(255,255,255,0.04)' } },
  y: { ticks: { color: '#4a5a78', font: { size: 10, family: 'Inter' } }, grid: { color: 'rgba(255,255,255,0.04)' } },
};

function renderROIChart(s) {
  const ctx = document.getElementById('roi-chart').getContext('2d');
  if (_roiChart) _roiChart.destroy();
  const labels = s.pmH.map(h => h.nome.replace(/UFC\s*/i, '').trim().substring(0, 18));
  const data = s.pmH.map(h => h.cum);
  const last = data[data.length - 1] || 0;
  const color = last >= 0 ? '#34d399' : '#f87171';
  _roiChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'ROI Acumulado',
        data,
        borderColor: color,
        backgroundColor: color + '18',
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: color,
        pointBorderColor: 'var(--bg)',
        pointBorderWidth: 2,
        fill: true,
        tension: 0.35,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ' ' + (c.parsed.y >= 0 ? '+' : '') + c.parsed.y.toFixed(2) + 'u' } }
      },
      scales: {
        x: { ...CHART_DEFAULTS.x, ticks: { ...CHART_DEFAULTS.x.ticks, maxRotation: 45 } },
        y: { ...CHART_DEFAULTS.y, ticks: { ...CHART_DEFAULTS.y.ticks, callback: v => v + 'u' } }
      }
    }
  });
}

function renderROICompare(s) {
  const cards = [
    { label: '🥊 PunterMMA', cls: '', roi: parseFloat(s.pmROI), pct: parseFloat(s.pmROIPct) || 0, picks: s.pmPicks, acertos: s.pmAcertos, desc: 'Picks EV+ calculados antes de cada evento' },
    { label: '🔒 Consenso Unânime', cls: 'purple', roi: parseFloat(s.lockROI), pct: parseFloat(s.lockROIPct) || 0, picks: s.lockPicks, acertos: s.lockAcertos, desc: 'Lutas onde todos os tipsters concordaram' },
    { label: '⭐ Super Favoritos', cls: 'cyan', roi: parseFloat(s.favROI), pct: parseFloat(s.favROIPct) || 0, picks: s.favPicks, acertos: s.favAcertos, desc: 'Favorito de cada luta com odds < 1.35' },
    { label: '🦓 Super Zebras', cls: 'zebra', roi: parseFloat(s.zebraROI), pct: parseFloat(s.zebraROIPct) || 0, picks: s.zebraPicks, acertos: s.zebraAcertos, desc: 'Azarão de cada luta com odds ≥ 2.50' },
  ];
  document.getElementById('roi-compare').innerHTML = cards.map(c => `
    <div class="roi-card ${c.cls}">
      <div class="roi-label">${c.label}</div>
      <div class="roi-number ${c.roi > 0 ? 'pos' : c.roi < 0 ? 'neg' : 'neu'}">${c.roi >= 0 ? '+' : ''}${c.roi.toFixed(2)}u</div>
      <div class="roi-desc">${c.desc}</div>
      <div class="roi-detail">
        <div class="roi-d-item">Picks: <span>${c.picks || 0}</span></div>
        <div class="roi-d-item">Acertos: <span>${c.acertos || 0}</span></div>
        <div class="roi-d-item">Hit%: <span>${c.picks > 0 ? (c.acertos / c.picks * 100).toFixed(0) + '%' : '—'}</span></div>
        <div class="roi-d-item">ROI%: <span style="color:${c.pct > 0 ? 'var(--green)' : c.pct < 0 ? 'var(--red)' : 'inherit'}">${c.pct >= 0 ? '+' : ''}${c.pct}%</span></div>
      </div>
    </div>`).join('');
}

function renderCompareChart(s) {
  const ctx = document.getElementById('compare-chart').getContext('2d');
  if (_compareChart) _compareChart.destroy();
  const labels = s.pmH.map(h => h.nome.replace(/UFC\s*/i, '').trim().substring(0, 14));
  _compareChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '🥊 PunterMMA', data: s.pmH.map(h => h.cum), borderColor: '#e8b84b', backgroundColor: 'rgba(232,184,75,0.06)', borderWidth: 2.5, pointRadius: 3, fill: false, tension: 0.35 },
        { label: '🔒 Consenso', data: s.lockH.map(h => h.cum), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.06)', borderWidth: 2.5, pointRadius: 3, fill: false, tension: 0.35 },
        { label: '⭐ Super Favoritos', data: s.favH.map(h => h.cum), borderColor: '#00d4ff', borderWidth: 2, pointRadius: 3, fill: false, tension: 0.35, borderDash: [4, 3] },
        { label: '🦓 Super Zebras', data: s.zebH.map(h => h.cum), borderColor: '#fb923c', borderWidth: 2, pointRadius: 3, fill: false, tension: 0.35, borderDash: [4, 3] },
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#8896b3', font: { size: 11, family: 'Inter' }, boxWidth: 20, padding: 14 } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${(c.parsed.y >= 0 ? '+' : '') + c.parsed.y.toFixed(2)}u` } }
      },
      scales: {
        x: { ...CHART_DEFAULTS.x, ticks: { ...CHART_DEFAULTS.x.ticks, maxRotation: 45 } },
        y: { ...CHART_DEFAULTS.y, ticks: { ...CHART_DEFAULTS.y.ticks, callback: v => v + 'u' } }
      }
    }
  });
}

// ── ODDS CATEGORIES ───────────────────────────────────────────────
function renderOddsCats() {
  const stats = computeOddsCatsPick();
  const rows = ODDS_CATS.map(c => {
    const s = stats[c.key];
    const roi = +s.roi.toFixed(2);
    const acertos = s.picks > 0 ? `${s.acertos}/${s.picks}` : '—';
    const roiPct = s.picks > 0 ? (s.roi / s.picks * 100).toFixed(1) : '—';
    const cls = roi > 0 ? 'roi-pos' : roi < 0 ? 'roi-neg' : 'roi-neu';
    const hr = s.picks > 0 ? (s.acertos / s.picks * 100).toFixed(0) + '%' : '—';
    return `<tr>
      <td><span class="cat-dot" style="background:${c.color}"></span><strong>${c.icon} ${c.label}</strong></td>
      <td style="color:var(--text2)">${c.faixa}</td>
      <td style="color:var(--text2)">${acertos}</td>
      <td style="color:var(--text2)">${hr}</td>
      <td class="${cls}">${roi >= 0 ? '+' : ''}${roi}u</td>
      <td class="${cls}">${roiPct !== '—' ? (parseFloat(roiPct) >= 0 ? '+' : '') + roiPct + '%' : '—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('odds-cats-container').innerHTML = `
    <div class="ev-table-wrap">
      <table class="odds-cat-table">
        <thead><tr><th>Categoria</th><th>Faixa de Odds</th><th>Acertos</th><th>Hit%</th><th>ROI Total</th><th>ROI%</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderOddsCatsGeral() {
  const stats = computeOddsCatsGeral();
  const rows = ODDS_CATS.map(c => {
    const s = stats[c.key];
    const roi = +s.roi.toFixed(2);
    const acertos = s.picks > 0 ? `${s.acertos}/${s.picks}` : '—';
    const roiPct = s.picks > 0 ? (s.roi / s.picks * 100).toFixed(1) : '—';
    const cls = roi > 0 ? 'roi-pos' : roi < 0 ? 'roi-neg' : 'roi-neu';
    const hr = s.picks > 0 ? (s.acertos / s.picks * 100).toFixed(0) + '%' : '—';
    return `<tr>
      <td><span class="cat-dot" style="background:${c.color}"></span><strong>${c.icon} ${c.label}</strong></td>
      <td style="color:var(--text2)">${c.faixa}</td>
      <td style="color:var(--text2)">${acertos}</td>
      <td style="color:var(--text2)">${hr}</td>
      <td class="${cls}">${roi >= 0 ? '+' : ''}${roi}u</td>
      <td class="${cls}">${roiPct !== '—' ? (parseFloat(roiPct) >= 0 ? '+' : '') + roiPct + '%' : '—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('odds-geral-container').innerHTML = `
    <div class="ev-table-wrap">
      <table class="odds-cat-table">
        <thead><tr><th>Categoria</th><th>Faixa de Odds</th><th>Acertos</th><th>Hit%</th><th>ROI Total</th><th>ROI%</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── ALL PICKS TABLE ────────────────────────────────────────────────
function renderAllPicks() {
  const STAKE = 100;
  let cumLucro = 0;
  const evRows = [];
  _eventos.forEach(ev => {
    let picks = 0, acertos = 0, evLucro = 0;
    ev.lutas.forEach(luta => {
      if (!luta.picks) return;
      const pmPick = luta.picks['🧠 PunterMind'];
      if (!pmPick || !luta.resultado) return;
      if (NULO.some(x => luta.resultado.toUpperCase().includes(x))) return;
      const odds = findOdds(ev.oddCard, pmPick);
      if (!odds) return;
      const pickL = pmPick.toLowerCase().split(' ').pop();
      const acertou = luta.resultado.toLowerCase().includes(pickL);
      picks++;
      evLucro += acertou ? STAKE * (odds - 1) : -STAKE;
      if (acertou) acertos++;
    });
    if (!picks) return;
    cumLucro += evLucro;
    evRows.push({ evento: ev.nome, picks, acertos, erros: picks - acertos, investido: picks * STAKE, evLucro: Math.round(evLucro), cum: Math.round(cumLucro) });
  });
  if (!evRows.length) {
    document.getElementById('all-picks-container').innerHTML = '<div class="empty"><div class="empty-icon">📋</div>Nenhum pick encontrado.</div>';
    return;
  }
  const rows = evRows.map(r => {
    const hit = r.picks > 0 ? (r.acertos / r.picks * 100).toFixed(0) + '%' : '—';
    const roiCls = r.evLucro > 0 ? 'roi-pos' : r.evLucro < 0 ? 'roi-neg' : 'roi-neu';
    const cumCls = r.cum > 0 ? 'roi-pos' : r.cum < 0 ? 'roi-neg' : 'roi-neu';
    const roiPct = r.investido > 0 ? ((r.evLucro / r.investido) * 100).toFixed(1) : '—';
    return `<tr>
      <td style="font-weight:600">${r.evento}</td>
      <td style="color:var(--text2);text-align:center">${r.picks}</td>
      <td style="color:var(--green);text-align:center">${r.acertos}</td>
      <td style="color:var(--red);text-align:center">${r.erros}</td>
      <td style="color:var(--text2);text-align:center">${hit}</td>
      <td class="${roiCls}" style="text-align:center">${r.evLucro >= 0 ? '+' : ''}R$${r.evLucro}</td>
      <td class="${roiCls}" style="text-align:center">${roiPct !== '—' ? (parseFloat(roiPct) >= 0 ? '+' : '') + roiPct + '%' : '—'}</td>
      <td class="${cumCls}" style="text-align:center;font-weight:700">${r.cum >= 0 ? '+' : ''}R$${r.cum}</td>
    </tr>`;
  }).join('');
  document.getElementById('all-picks-container').innerHTML = `
    <div class="ev-table-wrap">
      <table class="odds-cat-table">
        <thead><tr>
          <th>Evento</th><th style="text-align:center">Picks</th><th style="text-align:center">✅</th>
          <th style="text-align:center">❌</th><th style="text-align:center">Hit%</th>
          <th style="text-align:center">Lucro (R$100/pick)</th><th style="text-align:center">ROI%</th>
          <th style="text-align:center">Acumulado</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── APOSTAS ROI ────────────────────────────────────────────────────
function renderApostasROI() {
  const r = computeApostasROI();
  const rows = [
    { label: '💰 Simples', roi: r.sROI, picks: r.sP, acertos: r.sA },
    { label: '💰💰 Dupla', roi: r.dROI, picks: r.dP, acertos: r.dA },
    { label: '💰💰💰 Tripla', roi: r.tROI, picks: r.tP, acertos: r.tA },
  ].map(c => {
    const roi = c.roi.toFixed(2);
    const hit = c.picks > 0 ? (c.acertos / c.picks * 100).toFixed(0) + '%' : '—';
    const roiPct = c.picks > 0 ? (c.roi / c.picks * 100).toFixed(1) : '—';
    const cls = c.roi > 0 ? 'roi-pos' : c.roi < 0 ? 'roi-neg' : 'roi-neu';
    return `<tr>
      <td><strong>${c.label}</strong></td>
      <td style="color:var(--text2)">${c.picks}</td>
      <td style="color:var(--text2)">${c.acertos}</td>
      <td style="color:var(--text2)">${hit}</td>
      <td class="${cls}">${c.roi >= 0 ? '+' : ''}${roi}u</td>
      <td class="${cls}">${roiPct !== '—' ? (parseFloat(roiPct) >= 0 ? '+' : '') + roiPct + '%' : '—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('apostas-roi-table').innerHTML = `
    <div class="ev-table-wrap">
      <table class="odds-cat-table">
        <thead><tr><th>Tipo</th><th>Eventos</th><th>Acertos</th><th>Hit%</th><th>ROI Total</th><th>ROI%</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── STYLE STATS ────────────────────────────────────────────────────
function renderStyleStats() {
  const matchups = computeStyleStats();
  const entries = Object.entries(matchups).sort((a, b) => b[1].total - a[1].total);
  const cols = ['gold', 'cyan', 'purple', 'green'];
  document.getElementById('style-grid').innerHTML = entries.length
    ? entries.map(([key, val], idx) => {
        const [catA, catB] = key.split(' vs ');
        const wA = val.wins[catA] || 0, wB = val.wins[catB] || 0;
        const pA = val.total > 0 ? Math.round(wA / val.total * 100) : 0;
        return `<div class="style-card">
          <div class="style-matchup">${catA} vs ${catB}</div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-bottom:5px"><span>${catA} vence</span><span>${catB} vence</span></div>
          <div class="style-bar-wrap"><div class="style-bar ${cols[idx % 4]}" style="width:${pA}%"></div></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
            <div class="style-pct">${pA}% <span style="font-size:10px;color:var(--text3)">(${wA})</span></div>
            <div class="style-total">${val.total} lutas</div>
            <div class="style-pct">${100 - pA}% <span style="font-size:10px;color:var(--text3)">(${wB})</span></div>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty"><div class="empty-icon">🥊</div>Dados insuficientes na aba Lutadores.</div>';

  const ctx = document.getElementById('style-chart').getContext('2d');
  if (_styleChart) _styleChart.destroy();
  if (!entries.length) return;
  const allCats = {};
  entries.forEach(([, val]) => Object.entries(val.wins || {}).forEach(([cat, w]) => { allCats[cat] = (allCats[cat] || 0) + w; }));
  const catKeys = Object.keys(allCats).sort();
  const catColors = { 'Striker': 'rgba(248,113,113,0.75)', 'Grappler': 'rgba(52,211,153,0.75)', 'All-Round': 'rgba(0,212,255,0.75)', 'Wrestler': 'rgba(139,92,246,0.75)' };
  _styleChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: catKeys,
      datasets: [{ data: catKeys.map(k => allCats[k]), backgroundColor: catKeys.map(k => catColors[k] || 'rgba(232,184,75,0.75)'), borderColor: 'rgba(0,0,0,0.3)', borderWidth: 2 }]
    },
    options: { responsive: true, cutout: '62%', plugins: { legend: { labels: { color: '#8896b3', font: { family: 'Inter', size: 12 } } } } }
  });
}

// ── RENDER EVENTO (com análise física) ────────────────────────────
// ── REFRESH ONLY AFFECTED CARDS (sem re-render da página inteira) ───────────
function refreshFighterCards(fighterName) {
  if (!fighterName) { renderEvento(); return; }
  const nl = fighterName.toLowerCase().trim();

  // Encontra o evento atual
  const nome = document.getElementById('evento-sel')?.value;
  const ev = _eventos?.find(e => e.nome === nome);
  if (!ev) { renderEvento(); return; }

  // Atualiza só os cards que contêm esse lutador
  const cardEls = document.querySelectorAll('[data-card-idx]');
  if (!cardEls.length) { renderEvento(); return; }

  let updated = 0;
  ev.cardLutas?.forEach((c, idx) => {
    const fVn = (c.fV || '').toLowerCase();
    const fAn = (c.fA || '').toLowerCase();
    if (!fVn.includes(nl) && !fAn.includes(nl)) return;

    const el = document.querySelector(`[data-card-idx="${idx}"]`);
    if (!el) return;

    const newHtml = buildFightCard(c, ev, idx);
    if (!newHtml) return;

    // Cria elemento temporário e atualiza só o conteúdo interno (sem animação)
    const tmp = document.createElement('div');
    tmp.innerHTML = newHtml.trim();
    const newCard = tmp.firstElementChild;
    if (newCard) {
      newCard.style.animationDelay = '0s'; // sem delay no update
      el.replaceWith(newCard);
      updated++;
    }
  });

  // Se não achou nenhum card pra atualizar, faz render completo
  if (updated === 0) renderEvento();
}

function renderEvento() {
  const sel = document.getElementById('evento-sel');
  if (!sel) return;
  const nome = sel.value;
  const ev = _eventos.find(e => e.nome === nome);
  if (!ev) return;

  document.getElementById('ev-meta').textContent = ev.dataEvento ? `📅 ${ev.dataEvento}` : '';

  // SEÇÃO PRINCIPAL: FIGHT CARDS com análise física
  const cardEl = document.getElementById('fight-cards-container');
  if (ev.cardLutas && ev.cardLutas.length) {
    const cards = ev.cardLutas.map((c, idx) => buildFightCard(c, ev, idx));
    cardEl.innerHTML = `<div class="fight-cards-grid">${cards.join('')}</div>`;
  } else {
    cardEl.innerHTML = '<div class="empty"><div class="empty-icon">🥊</div>Nenhuma luta encontrada para este evento.</div>';
  }

  // PunterMind análise tabela
  const pa = ev.punterAnalise;
  if (!pa.length) {
    document.getElementById('ev-table-container').innerHTML = '<div class="empty"><div class="empty-icon">📊</div>Nenhuma análise PunterMind encontrada para este evento.</div>';
  } else {
    const rows = pa.map(pm => {
      const evRaw = (pm.ev || '').trim();
      const isConsenso = evRaw.toUpperCase().includes('CONSENSO') || !evRaw || evRaw === '0.00';
      const evNum = isConsenso ? 0 : parseFloat(evRaw.replace(',', '.').replace('+', '')) || 0;
      const evTag = isConsenso
        ? `<span class="badge badge-lock">🔒 CONSENSO</span>`
        : evNum > 0
          ? `<span class="badge badge-ev-p">▲ ${evRaw}</span>`
          : `<span class="badge badge-ev-n">▼ ${evRaw}</span>`;
      return `<tr>
        <td style="font-weight:600">${pm.luta}</td>
        <td style="font-size:12px;color:var(--text2);max-width:200px">${pm.fisico || '—'}</td>
        <td style="font-weight:700;color:var(--cyan)">${pm.probReal || pm.probImp || '—'}</td>
        <td>${evTag}</td>
        <td style="font-weight:700;color:var(--gold)">${pm.pick ? '🥊 ' + pm.pick : '—'}</td>
        <td style="font-size:12px;color:var(--text2)">${pm.met || '—'}</td>
        <td style="font-size:12px;color:var(--text2);max-width:240px;line-height:1.4">${pm.nota || '—'}</td>
      </tr>`;
    }).join('');
    document.getElementById('ev-table-container').innerHTML = `
      <div class="ev-table-wrap">
        <table class="ev-table">
          <thead><tr><th>Luta</th><th>Vantagem Física</th><th>Prob. Real</th><th>EV</th><th>Pick</th><th>Mét.</th><th>Nota</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // Apostas sugeridas
  const ap = ev.apostas;
  if (ap && (ap.simples.selecao || ap.dupla.selecao || ap.tripla.selecao)) {
    const apostaCards = [ap.simples, ap.dupla, ap.tripla].filter(a => a.selecao).map(a => `
      <div class="aposta-card">
        <div class="ap-tipo">${a.tipo || '—'}</div>
        <div class="ap-sel">${a.selecao}</div>
        <div class="ap-odd">${a.odd || '—'}</div>
        <div class="ap-nota">${a.nota || ''}</div>
      </div>`).join('');
    document.getElementById('ev-apostas-container').innerHTML = `<div class="label-small">🎯 Apostas Sugeridas</div><div class="apostas-grid">${apostaCards}</div>`;
  } else {
    document.getElementById('ev-apostas-container').innerHTML = '';
  }

  if (_currentTab === 'futuros') {
    updateStakesCalculator();
  }
}

// NOVO BUILD FIGHT CARD
function buildFightCard(c, ev, idx) {
  const { fV, oV, fA, oA } = c;
  if (!fV && !fA) return '';

  const editIconV = fV ? `<span class="fc-edit-btn" onclick="openFighterModal('${fV.replace(/'/g, "\\\\'")}')" title="Editar dados físicos de ${fV}">✏️</span>` : '';
  const editIconA = fA ? `<span class="fc-edit-btn" onclick="openFighterModal('${fA.replace(/'/g, "\\\\'")}')" title="Editar dados físicos de ${fA}">✏️</span>` : '';

  // Dados do DB de lutadores
  let dbA = typeof getFighterData === 'function' ? getFighterData(fV) : null;
  let dbB = typeof getFighterData === 'function' ? getFighterData(fA) : null;

  // Usa dados da ESPN (Scoreboard Server-Side) como fonte primária agora
  const mapEspnDb = (espnFighter) => {
    if (!espnFighter) return null;
    let rec = espnFighter.record;
    let w = null, l = null, d = 0;
    if (rec) {
      const parts = rec.split('-');
      if (parts.length >= 2) {
        w = parseInt(parts[0]) || 0;
        l = parseInt(parts[1]) || 0;
        d = parseInt(parts[2]) || 0;
      }
    }
    return {
      wins: espnFighter.wins !== undefined && espnFighter.wins !== null ? espnFighter.wins : w,
      losses: espnFighter.losses !== undefined && espnFighter.losses !== null ? espnFighter.losses : l,
      draws: espnFighter.draws !== undefined && espnFighter.draws !== null ? espnFighter.draws : d,
      height_cm: espnFighter.height_cm || '—',
      reach_cm: espnFighter.reach_cm || '—',
      stance: espnFighter.stance || '',
      espn_photo: espnFighter.photo || null,
      style: '' 
    };
  };

  if (c.f1Obj) dbA = { ...(dbA || {}), ...mapEspnDb(c.f1Obj) };
  if (c.f2Obj) dbB = { ...(dbB || {}), ...mapEspnDb(c.f2Obj) };

  const fightersToCheck = [
    { name: fV, dbMerged: dbA },
    { name: fA, dbMerged: dbB }
  ];

  fightersToCheck.forEach(({name: fighter, dbMerged: db}) => {
    if (!fighter) return;
    
    // Se não temos dados físicos da ESPN no DB, ou se não temos foto (passados), precisamos buscar
    const isMissingStats = !db || !db.height_cm || db.height_cm === '—' || !db.espn_photo || db.wins === undefined || db.wins === null;
    
    // Se já sincronizou uma vez, não tenta de novo, mesmo que a foto seja null
    const jaTentouEspn = db && (db.not_found_espn === true || db.espn_sync_done === true);
    
    if (isMissingStats && window._fetchingEspn[fighter] !== true && window._fetchingEspn[fighter] !== 'not_found' && !jaTentouEspn) {
      window._fetchingEspn[fighter] = true;
      window._espnQueue.push(fighter);
      window._processEspnQueue();
    }
  });

  // Fallback Elegante (Silhouette SVG em Base64 para não depender de arquivo local)
  const defaultPhoto = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIj48Y2lyY2xlIGN4PSIxMDAiIGN5PSI3MCIgcj0iNDUiIGZpbGw9IiMyZDJkM2EiLz48cGF0aCBkPSJNMTAwIDEyNWMtNDAgMC03NSAzMC04NSA3NWgxNzBjLTEwLTQ1LTQ1LTc1LTg1LTc1eiIgZmlsbD0iIzJkMmQzYSIvPjwvc3ZnPg=='; 
  
  let photoV = c.espnPhotoV || dbA?.espn_photo;
  let photoA = c.espnPhotoA || dbB?.espn_photo;
  
  const isFetchingV = window._fetchingEspn[fV] === true && !photoV;
  const isFetchingA = window._fetchingEspn[fA] === true && !photoA;

  const renderPhoto = (url, name, isFetching) => {
    if (isFetching) return `<div class="tale-skeleton"><div class="skel-photo"></div></div>`;
    const finalUrl = (url && url !== 'null' && url !== 'undefined') ? url : defaultPhoto;
    
    return `<div class="tale-photo-wrap"><img src="${finalUrl}" class="tale-photo" loading="eager" decoding="async" fetchpriority="high" onerror="if(this.src !== '${defaultPhoto}'){ this.onerror=null; this.src='${defaultPhoto}'; }" alt="Foto de ${name || 'lutador'}" /></div>`;
  };

  // Formatadores Tale
  const fRecord = (db) => db && db.wins !== undefined && db.wins !== null ? `${db.wins}-${db.losses}${db.draws > 0 ? '-'+db.draws : ''}` : '—';
  const fHeight = (db) => db && db.height_cm ? `${(db.height_cm / 100).toFixed(2)}m` : '—';
  const fReach = (db) => db && db.reach_cm ? `${db.reach_cm}cm` : '—';
  const fStance = (db) => db && db.stance ? db.stance : '—';

  let rV = fRecord(dbA), rA = fRecord(dbB);
  let hV = fHeight(dbA), hA = fHeight(dbB);
  let eV = fReach(dbA), eA = fReach(dbB);
  let sV = fStance(dbA), sA = fStance(dbB);

  // Skeleton rows if fetching
  if (isFetchingV || isFetchingA) {
    rV = '<div class="tale-skeleton"><div class="skel-text"></div></div>';
    rA = '<div class="tale-skeleton"><div class="skel-text"></div></div>';
    hV = rV; hA = rA; eV = rV; eA = rA; sV = rV; sA = rA;
  }

  // Odds formatting
  const renderOdds = (oddNum, espnOddStr, isFav) => {
    if (oddNum) return `<div class="tale-odds ${isFav ? 'fav' : ''}">${oddNum.toFixed(2)}</div>`;
    if (espnOddStr) return `<div class="tale-odds" style="color:var(--gold); border-color:var(--gold);">${espnOddStr}</div>`;
    return '';
  };
  const oddsVHtml = renderOdds(oV, c.espnOdds, oV && oV < 1.5);
  const oddsAHtml = renderOdds(oA, c.espnOdds, oA && oA < 1.5);

  // Análise multi-fator
  const analysis = (typeof analyzeFight === 'function' && oV && oA)
    ? analyzeFight(fV, fA, oV, oA, dbA, dbB, _zebraStats)
    : null;

  // Resultado
  const luta = findLuta(ev, fV || fA);
  const resultado = luta?.resultado || null;
  const isWinV = resultado && resultado.toLowerCase().includes(fV.toLowerCase().split(' ').pop());
  const isWinA = resultado && resultado.toLowerCase().includes(fA.toLowerCase().split(' ').pop());

  // Badges (EV+, Zebra, AI Pick)
  let badges = '';
  if (analysis) {
    if (analysis.evA > 0.05) badges += `<span class="badge badge-ev-p">EV+ ${fV?.split(' ').pop()}</span>`;
    if (analysis.evB > 0.05) badges += `<span class="badge badge-ev-p">EV+ ${fA?.split(' ').pop()}</span>`;
    if (analysis.zebraAlert) badges += `<span class="badge badge-zebra">🦓 ZEBRA</span>`;
    if (analysis.pickRecommended) badges += `<span class="badge badge-conf-h">🤖 Pick: ${analysis.pickRecommended}</span>`;
  }
  if (resultado) {
    badges += `<span class="badge" style="background:rgba(52,211,153,0.1);color:var(--green);border:1px solid rgba(52,211,153,0.3)">✅ Venceu: ${resultado}</span>`;
  }

  // Botão de IA
  const aiBtnId = `ai-btn-${idx}`;
  const recPick = analysis?.pickRecommended ? analysis.pickRecommended.replace(/'/g, "\\'") : '';
  const aiHtml = `
    <div id="${aiBtnId}-container" style="margin-top: 12px; width: 100%;">
      <button class="ai-btn-card" onclick="analyzeFightWithAI('${(fV||'').replace(/'/g, "\\'")}', '${(fA||'').replace(/'/g, "\\'")}', '${aiBtnId}-container', '${recPick}')">
        🤖 Análise de IA
      </button>
    </div>
  `;

  return `
    <div class="tale-card" style="animation-delay:${idx * 0.05}s" data-fighters="${(fV||'').toLowerCase()}|${(fA||'').toLowerCase()}" data-card-idx="${idx}">
      ${(dbA?.weight_class || dbB?.weight_class) ? `<div class="tale-header">${dbA?.weight_class || dbB?.weight_class}</div>` : ''}
      
      <div class="tale-body">
        <div class="tale-fighter left ${isWinV ? 'winner' : ''}">
          ${renderPhoto(photoV, fV, isFetchingV)}
          <div class="tale-name">${fV || '—'} ${editIconV}</div>
          ${oddsVHtml}
        </div>

        <div class="tale-center">
          <div class="tale-row">
            <span class="val left">${rV}</span>
            <span class="lbl">CARTEL</span>
            <span class="val right">${rA}</span>
          </div>
          <div class="tale-row">
            <span class="val left">${hV}</span>
            <span class="lbl">ALTURA</span>
            <span class="val right">${hA}</span>
          </div>
          <div class="tale-row">
            <span class="val left">${eV}</span>
            <span class="lbl">ENVERGADURA</span>
            <span class="val right">${eA}</span>
          </div>
          <div class="tale-row">
            <span class="val left">${sV}</span>
            <span class="lbl">BASE</span>
            <span class="val right">${sA}</span>
          </div>
        </div>

        <div class="tale-fighter right ${isWinA ? 'winner' : ''}">
          ${renderPhoto(photoA, fA, isFetchingA)}
          <div class="tale-name">${fA || '—'} ${editIconA}</div>
          ${oddsAHtml}
        </div>
      </div>

      <div class="tale-badges">
        ${badges}
      </div>
      ${aiHtml}
    </div>
  `;
}


// ── DEMO MODE FALLBACK ───────────────────────────────────────────
const MOCK_EVENTO_299 = {
  nome: "UFC 299: O'Malley vs. Vera 2",
  dataEvento: "09/03/2024",
  cardLutas: [
    { fV: "Sean O'Malley", oV: 1.36, fA: "Marlon Vera", oA: 3.20 },
    { fV: "Dustin Poirier", oV: 2.80, fA: "Benoit Saint Denis", oA: 1.45 },
    { fV: "Michael Page", oV: 1.72, fA: "Kevin Holland", oA: 2.15 },
    { fV: "Gilbert Burns", oV: 2.35, fA: "Jack Della Maddalena", oA: 1.62 },
    { fV: "Petr Yan", oV: 1.70, fA: "Song Yadong", oA: 2.15 }
  ],
  lutas: [
    { luta: "Sean O'Malley vs Marlon Vera", resultado: "Sean O'Malley", metReal: "Decisão", picks: { "🧠 PunterMind": "Sean O'Malley" } },
    { luta: "Dustin Poirier vs Benoit Saint Denis", resultado: "Dustin Poirier", metReal: "KO/TKO", picks: { "🧠 PunterMind": "Dustin Poirier" } },
    { luta: "Michael Page vs Kevin Holland", resultado: "Michael Page", metReal: "Decisão", picks: { "🧠 PunterMind": "Michael Page" } },
    { luta: "Gilbert Burns vs Jack Della Maddalena", resultado: "Jack Della Maddalena", metReal: "KO/TKO", picks: { "🧠 PunterMind": "Jack Della Maddalena" } },
    { luta: "Petr Yan vs Song Yadong", resultado: "Petr Yan", metReal: "Decisão", picks: { "🧠 PunterMind": "Petr Yan" } }
  ],
  punterAnalise: [
    { luta: "Sean O'Malley vs Marlon Vera", fisico: "O'Malley +5cm alcance", probReal: "78%", ev: "+0.06", pick: "Sean O'Malley", met: "Decisão", nota: "O'Malley tem volume muito maior na trocação e domina a distância." },
    { luta: "Dustin Poirier vs Benoit Saint Denis", fisico: "Poirier +3cm alcance", probReal: "42%", ev: "+0.176", pick: "Dustin Poirier", met: "KO/TKO", nota: "Poirier vem como zebra mas tem experiência em lutas de 5 rounds contra o ímpeto de BSD." },
    { luta: "Michael Page vs Kevin Holland", fisico: "Page +5cm alcance", probReal: "62%", ev: "+0.066", pick: "Michael Page", met: "Decisão", nota: "Page tem estilo elusivo difícil de decifrar em sua estreia." },
    { luta: "Gilbert Burns vs Jack Della Maddalena", fisico: "Della Maddalena +7cm alcance", probReal: "65%", ev: "+0.053", pick: "Jack Della Maddalena", met: "KO/TKO", nota: "Jack Della Maddalena tem melhor boxe e vantagem de alcance na trocação." },
    { luta: "Petr Yan vs Song Yadong", fisico: "Yan +3cm alcance", probReal: "62%", ev: "+0.054", pick: "Petr Yan", met: "Decisão", nota: "Yan tem melhor QI de luta e ajustes ao longo dos rounds." }
  ],
  apostas: {
    simples: { tipo: "🔥 Melhor Pick", selecao: "Sean O'Malley", odd: "1.36", nota: "Volume e movimentação superiores." },
    dupla: { tipo: "🔒 Dupla Segura", selecao: "Sean O'Malley + Petr Yan", odd: "2.31", nota: "Favoritos consolidados tecnicamente." },
    tripla: { tipo: "🦓 Tripla Ousada", selecao: "Sean O'Malley + Petr Yan + Jack Della Maddalena", odd: "3.74", nota: "Jack entra com valor na trocação." }
  },
  oddCard: {
    "sean o'malley": 1.36, "marlon vera": 3.20,
    "dustin poirier": 2.80, "benoit saint denis": 1.45,
    "michael page": 1.72, "kevin holland": 2.15,
    "gilbert burns": 2.35, "jack della maddalena": 1.62,
    "petr yan": 1.70, "song yadong": 2.15
  }
};

const MOCK_EVENTO_300 = {
  nome: "UFC 300: Pereira vs. Hill",
  dataEvento: "13/04/2024",
  cardLutas: [
    { fV: "Alex Pereira", oV: 1.72, fA: "Jamahal Hill", oA: 2.15 },
    { fV: "Zhang Weili", oV: 1.20, fA: "Yan Xiaonan", oA: 4.80 },
    { fV: "Justin Gaethje", oV: 1.62, fA: "Max Holloway", oA: 2.35 },
    { fV: "Charles Oliveira", oV: 2.80, fA: "Arman Tsarukyan", oA: 1.45 },
    { fV: "Bo Nickal", oV: 1.05, fA: "Cody Brundage", oA: 10.0 }
  ],
  lutas: [
    { luta: "Alex Pereira vs Jamahal Hill", resultado: "Alex Pereira", metReal: "KO/TKO", picks: { "🧠 PunterMind": "Alex Pereira" } },
    { luta: "Zhang Weili vs Yan Xiaonan", resultado: "Zhang Weili", metReal: "Decisão", picks: { "🧠 PunterMind": "Zhang Weili" } },
    { luta: "Justin Gaethje vs Max Holloway", resultado: "Max Holloway", metReal: "KO/TKO", picks: { "🧠 PunterMind": "Justin Gaethje" } },
    { luta: "Charles Oliveira vs Arman Tsarukyan", resultado: "Arman Tsarukyan", metReal: "Decisão", picks: { "🧠 PunterMind": "Arman Tsarukyan" } },
    { luta: "Bo Nickal vs Cody Brundage", resultado: "Bo Nickal", metReal: "Submissão", picks: { "🧠 PunterMind": "Bo Nickal" } }
  ],
  punterAnalise: [
    { luta: "Alex Pereira vs Jamahal Hill", fisico: "Pereira +10cm envergadura", probReal: "62%", ev: "+0.066", pick: "Alex Pereira", met: "KO/TKO", nota: "Pereira tem grande vantagem física na trocação e Hill vem de lesão grave no tendão de Aquiles." },
    { luta: "Zhang Weili vs Yan Xiaonan", fisico: "Equilibrado", probReal: "83%", ev: "+0.00", pick: "Zhang Weili", met: "Decisão", nota: "Zhang Weili é muito superior na luta agarrada e controle de solo." },
    { luta: "Justin Gaethje vs Max Holloway", fisico: "Gaethje +10cm alcance", probReal: "65%", ev: "+0.053", pick: "Justin Gaethje", met: "KO/TKO", nota: "Gaethje tem golpes mais pesados, mas Holloway tem envergadura e volume." },
    { luta: "Charles Oliveira vs Arman Tsarukyan", fisico: "Oliveira +8cm altura", probReal: "38%", ev: "+0.064", pick: "Charles Oliveira", met: "Submissão", nota: "Tsarukyan é favorito pelas odds, mas o valor está no Jiu-Jitsu do Oliveira vindo como zebra." },
    { luta: "Bo Nickal vs Cody Brundage", fisico: "Nickal +5cm alcance", probReal: "95%", ev: "+0.00", pick: "Bo Nickal", met: "Submissão", nota: "Nickal é amplamente favorito devido ao seu nível olímpico de wrestling." }
  ],
  apostas: {
    simples: { tipo: "🔥 Melhor Pick", selecao: "Alex Pereira", odd: "1.72", nota: "Vantagem física crucial para manter a distância e nocautear." },
    dupla: { tipo: "🔒 Dupla Segura", selecao: "Zhang Weili + Bo Nickal", odd: "1.26", nota: "Dois favoritos dominantes com amplo controle de solo." },
    tripla: { tipo: "🦓 Tripla Ousada", selecao: "Alex Pereira + Zhang Weili + Charles Oliveira", odd: "5.78", nota: "Buscando o valor na zebra do Charles Oliveira." }
  },
  oddCard: {
    "alex pereira": 1.72, "jamahal hill": 2.15,
    "zhang weili": 1.20, "yan xiaonan": 4.80,
    "justin gaethje": 1.62, "max holloway": 2.35,
    "charles oliveira": 2.80, "arman tsarukyan": 1.45,
    "bo nickal": 1.05, "cody brundage": 10.0
  }
};

const MOCK_EVENTO_301 = {
  nome: "UFC 301: Pantoja vs. Erceg",
  dataEvento: "04/05/2024",
  cardLutas: [
    { fV: "Alexandre Pantoja", oV: 1.53, fA: "Steve Erceg", oA: 2.50 },
    { fV: "Jonathan Martinez", oV: 2.20, fA: "Jose Aldo", oA: 1.67 },
    { fV: "Anthony Smith", oV: 4.50, fA: "Vitor Petrino", oA: 1.22 },
    { fV: "Michel Pereira", oV: 1.18, fA: "Ihor Potieria", oA: 5.00 },
    { fV: "Caio Borralho", oV: 1.15, fA: "Paul Craig", oA: 5.50 }
  ],
  lutas: [
    { luta: "Alexandre Pantoja vs Steve Erceg", resultado: "", metReal: "", picks: { "🧠 PunterMind": "Alexandre Pantoja" } },
    { luta: "Jonathan Martinez vs Jose Aldo", resultado: "", metReal: "", picks: { "🧠 PunterMind": "Jose Aldo" } },
    { luta: "Anthony Smith vs Vitor Petrino", resultado: "", metReal: "", picks: { "🧠 PunterMind": "Vitor Petrino" } },
    { luta: "Michel Pereira vs Ihor Potieria", resultado: "", metReal: "", picks: { "🧠 PunterMind": "Michel Pereira" } },
    { luta: "Caio Borralho vs Paul Craig", resultado: "", metReal: "", picks: { "🧠 PunterMind": "Caio Borralho" } }
  ],
  punterAnalise: [
    { luta: "Alexandre Pantoja vs Steve Erceg", fisico: "Erceg +3cm altura", probReal: "68%", ev: "+0.04", pick: "Alexandre Pantoja", met: "Decisão", nota: "Pantoja tem maior volume de grappling e pressão no solo." },
    { luta: "Jonathan Martinez vs Jose Aldo", fisico: "Martinez +5cm alcance", probReal: "65%", ev: "+0.085", pick: "Jose Aldo", met: "Decisão", nota: "Aldo tem excelente defesa de quedas/chutes e contragolpes de boxe refinados." },
    { luta: "Anthony Smith vs Vitor Petrino", fisico: "Petrino +5cm alcance", probReal: "85%", ev: "+0.037", pick: "Vitor Petrino", met: "KO/TKO", nota: "Petrino é jovem, atlético e explosivo contra o veterano Smith." },
    { luta: "Michel Pereira vs Ihor Potieria", fisico: "Pereira +5cm alcance", probReal: "87%", ev: "+0.026", pick: "Michel Pereira", met: "Submissão", nota: "Michel Pereira é muito mais ágil e forte fisicamente na divisão dos médios." },
    { luta: "Caio Borralho vs Paul Craig", fisico: "Borralho +3cm alcance", probReal: "90%", ev: "+0.035", pick: "Caio Borralho", met: "KO/TKO", nota: "Borralho tem striking técnico e wrestling para anular o jiu-jitsu perigoso de Craig." }
  ],
  apostas: {
    simples: { tipo: "🔥 Melhor Pick", selecao: "Caio Borralho", odd: "1.15", nota: "Wrestling e striking muito superiores." },
    dupla: { tipo: "🔒 Dupla Segura", selecao: "Caio Borralho + Michel Pereira", odd: "1.35", nota: "Favoritos muito dominantes e explosivos." },
    tripla: { tipo: "🦓 Tripla Ousada", selecao: "Caio Borralho + Michel Pereira + Jose Aldo", odd: "2.26", nota: "Buscando valor com a vitória do veterano Aldo no Rio." }
  },
  oddCard: {
    "alexandre pantoja": 1.53, "steve erceg": 2.50,
    "jonathan martinez": 2.20, "jose aldo": 1.67,
    "anthony smith": 4.50, "vitor petrino": 1.22,
    "michel pereira": 1.18, "ihor potieria": 5.00,
    "caio borralho": 1.15, "paul craig": 5.50
  }
};

function loadDemoData() {
  _eventos = [MOCK_EVENTO_299, MOCK_EVENTO_300, MOCK_EVENTO_301];
  
  _eventos.forEach(ev => {
    ev.isFuturo = ev.lutas.length === 0 || ev.lutas.every(l => !l.resultado || l.resultado.trim() === '' || l.resultado.trim() === '?');
  });

  _lutadores = {
    "alex pereira": "Striker",
    "jamahal hill": "Striker",
    "zhang weili": "All-Round",
    "yan xiaonan": "Striker",
    "justin gaethje": "Striker",
    "max holloway": "Striker",
    "charles oliveira": "Grappler",
    "arman tsarukyan": "All-Round",
    "bo nickal": "Wrestler",
    "cody brundage": "Grappler",
    "sean o'malley": "Striker",
    "marlon vera": "All-Round",
    "dustin poirier": "All-Round",
    "benoit saint denis": "Striker",
    "michael page": "Striker",
    "kevin holland": "All-Round",
    "gilbert burns": "Grappler",
    "jack della maddalena": "Striker",
    "petr yan": "All-Round",
    "song yadong": "Striker",
    "alexandre pantoja": "Grappler",
    "steve erceg": "Grappler",
    "jonathan martinez": "Striker",
    "jose aldo": "All-Round",
    "anthony smith": "Striker",
    "vitor petrino": "Striker",
    "michel pereira": "Striker",
    "ihor potieria": "Striker",
    "caio borralho": "All-Round",
    "paul craig": "Grappler"
  };
  _tipsters = ["🧠 PunterMind", "Tipster A"];
  _zebraStats = computeOddsCatsGeral();
  renderAll();
}

// ── BANNER AVISO DE DEMO ─────────────────────────────────────────
function showDemoWarning(errorMsg) {
  let container = document.getElementById('demo-banner-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'demo-banner-container';
    document.body.insertBefore(container, document.body.firstChild);
  }
  container.innerHTML = `
    <div class="demo-banner">
      <div class="demo-banner-left">
        <span class="demo-banner-icon">⚠️</span>
        <span><strong>Modo de Demonstração Ativo</strong>: Não foi possível conectar à sua planilha Google (${escHtml(errorMsg)}). Exibindo dados locais offline.</span>
      </div>
      <button class="demo-banner-close" onclick="closeDemoBanner()">✕</button>
    </div>
  `;
}

function closeDemoBanner() {
  const container = document.getElementById('demo-banner-container');
  if (container) container.style.display = 'none';
}

// ── SISTEMA DE ABAS ──────────────────────────────────────────────
function switchTab(tabId) {
  _currentTab = tabId;
  
  // Atualizar botões das abas
  const btnFuturos = document.getElementById('tab-btn-futuros');
  const btnPassados = document.getElementById('tab-btn-passados');
  const btnHistorico = document.getElementById('tab-btn-historico');
  
  if (btnFuturos) btnFuturos.classList.toggle('active', tabId === 'futuros');
  if (btnPassados) btnPassados.classList.toggle('active', tabId === 'passados');
  if (btnHistorico) btnHistorico.classList.toggle('active', tabId === 'historico');
  
  if (tabId === 'historico') {
    const stats = computeStats();
    if (typeof renderROIChart === 'function') renderROIChart(stats);
    if (typeof renderCompareChart === 'function') renderCompareChart(stats);
    if (typeof renderStyleStats === 'function') renderStyleStats();
  }
  
  // Alternar exibições de conteúdo
  const contentCards = document.getElementById('tab-content-cards');
  const contentHistorico = document.getElementById('tab-content-historico');
  
  if (contentCards) contentCards.style.display = (tabId === 'futuros' || tabId === 'passados') ? 'block' : 'none';
  if (contentHistorico) contentHistorico.style.display = tabId === 'historico' ? 'block' : 'none';
  
  populateEventSelector(tabId);
}

function populateEventSelector(tabId) {
  const sel = document.getElementById('evento-sel');
  const bar = document.getElementById('ev-picker-bar');
  if (!sel) return;

  const prevVal = sel.value;
  sel.innerHTML = '';

  // Determinar o que mostrar
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  function evDate(ev) {
    if (!ev.dataEvento) return null;
    const s = String(ev.dataEvento).trim();
    if (s.includes('/')) {
      const p = s.split('/');
      if (p.length === 3) return new Date(`${p[2]}-${p[1]}-${p[0]}T12:00:00`);
    }
    const parsed = Date.parse(s);
    if (!isNaN(parsed)) return new Date(parsed);
    return null;
  }

  // Separar futuros (incluindo hoje) e passados
  const futuros  = _eventos.filter(e => { const d = evDate(e); return !d || d >= hoje; });
  const passados = _eventos.filter(e => { const d = evDate(e); return d && d < hoje; });

  // Decidir lista ativa com base na aba
  let listaAtiva;
  if (tabId === 'futuros') {
    listaAtiva = futuros;
  } else if (tabId === 'passados') {
    listaAtiva = passados;
  } else {
    listaAtiva = passados.length ? passados : _eventos;
  }
  // Se a lista estiver vazia por algum motivo, mostramos todos
  if (!listaAtiva.length) listaAtiva = _eventos;

  // Preencher <select> oculto (todos os eventos da lista ativa)
  listaAtiva.forEach(ev => {
    const opt = document.createElement('option');
    opt.value = ev.nome;
    opt.textContent = ev.nome;
    sel.appendChild(opt);
  });

  // Selecionar evento
  let selectedName;
  if (listaAtiva.some(e => e.nome === prevVal)) {
    selectedName = prevVal;
  } else if (tabId === 'futuros' && listaAtiva.length) {
    // Próximo futuro: mais cedo no tempo
    const sorted = [...listaAtiva].sort((a, b) => {
      const da = evDate(a), db = evDate(b);
      if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
      return da - db;
    });
    selectedName = sorted[0].nome;
  } else if (listaAtiva.length) {
    // Histórico: mais recente
    const sorted = [...listaAtiva].sort((a, b) => {
      const parseDate = s => {
        if (!s) return 0;
        if (s.includes('/')) {
          const parts = s.split('/');
          if (parts.length === 3) {
            const [dia, mes, ano] = parts;
            return new Date(ano, mes - 1, dia).getTime() || 0;
          }
        }
        const parsed = Date.parse(s);
        return isNaN(parsed) ? 0 : parsed;
      };
      return parseDate(b.dataEvento) - parseDate(a.dataEvento);
    });
    selectedName = sorted[0].nome;
  }

  if (selectedName) sel.value = selectedName;

  // ── RENDER PILLS BAR ──────────────────────────────────────────
  if (!bar) { renderEvento(); return; }

  bar.innerHTML = '';

  function pillType(nome) {
    if (/^UFC\s+\d+/i.test(nome)) return 'ufc';
    return 'fn';
  }

  function pillLabel(nome) {
    const m = nome.match(/^(UFC\s+\d+)/i);
    if (m) return m[1];
    return nome.replace(/^FN\s+/i, '').replace(/^UFC Fight Night:\s*/i, '').trim();
  }

  function makePillsRow(list) {
    const row = document.createElement('div');
    row.className = 'ev-pills-row';
    // Ordenar: futuros → crescente, passados/histórico → decrescente
    const sorted = [...list].sort((a, b) => {
      const da = evDate(a), db = evDate(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return tabId === 'futuros' ? da - db : db - da;
    });
    sorted.forEach(ev => {
      const type = pillType(ev.nome);
      const label = pillLabel(ev.nome);
      const hasResult = !ev.isFuturo;
      const isActive = ev.nome === selectedName;

      const pill = document.createElement('div');
      pill.className = [
        'ev-pill',
        isActive ? 'active' : '',
        hasResult ? 'has-result' : ''
      ].filter(Boolean).join(' ');

      pill.dataset.nome = ev.nome;
      pill.innerHTML = `<span class="ev-pill-badge ${type}">${type === 'ufc' ? 'UFC' : 'FN'}</span>${label}`;
      pill.addEventListener('click', () => selectPill(ev.nome));
      row.appendChild(pill);
    });
    return row;
  }

  // Renderizar apenas a lista correspondente à aba ativa
  if (listaAtiva.length) {
    const grp = document.createElement('div');
    grp.className = 'ev-picker-group';
    const lbl = document.createElement('div');
    lbl.className = 'ev-picker-group-label';
    
    if (tabId === 'futuros') {
      lbl.textContent = '📅 Próximos Eventos';
    } else if (tabId === 'passados') {
      lbl.textContent = '🕒 Lutas Passadas';
    } else {
      lbl.textContent = '📊 Todos os Eventos (Histórico)';
    }
    
    grp.appendChild(lbl);
    grp.appendChild(makePillsRow(listaAtiva));
    bar.appendChild(grp);
  }

  // Auto-scroll para a pill ativa
  requestAnimationFrame(() => {
    const activePill = bar.querySelector('.ev-pill.active');
    if (activePill) {
      activePill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  });

  renderEvento();
}

function selectPill(nome) {
  const sel = document.getElementById('evento-sel');
  const bar = document.getElementById('ev-picker-bar');
  if (sel) sel.value = nome;

  // Atualizar pills
  if (bar) {
    bar.querySelectorAll('.ev-pill').forEach(p => {
      const isActive = p.dataset.nome === nome;
      p.classList.toggle('active', isActive);
      if (isActive) p.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  }

  renderEvento();
}



// ── CALCULADORA DE STAKES (GESTÃO DE RISCO) ──────────────────────
function updateStakesCalculator() {
  const nome = document.getElementById('evento-sel').value;
  const ev = _eventos.find(e => e.nome === nome);
  const container = document.getElementById('stakes-calc-results');
  if (!ev || !container) return;

  // Parâmetros da banca
  const bankroll = parseFloat(document.getElementById('bk-initial').value) || 10000;
  const baseStake = parseFloat(document.getElementById('bk-base-stake').value) || 200;
  const kellyFraction = parseFloat(document.getElementById('bk-kelly-fraction').value) || 0.25;
  const currency = document.getElementById('bk-currency').value;
  const strategy = document.getElementById('bk-strategy').value;

  const stakesList = [];
  (ev.cardLutas || []).forEach(c => {
    const { fV, oV, fA, oA } = c;
    if (!fV || !fA || !oV || !oA) return;

    const dbA = getFighterData(fV);
    const dbB = getFighterData(fA);
    const analysis = analyzeFight(fV, fA, oV, oA, dbA, dbB, _zebraStats);

    if (analysis && analysis.pickRecommended) {
      const pickName = analysis.pickRecommended;
      const isV = pickName.toLowerCase() === fV.toLowerCase();
      const odds = isV ? oV : oA;
      const prob = isV ? analysis.probAdjA : analysis.probAdjB;
      const evValue = isV ? analysis.evA : analysis.evB;
      const confidence = isV ? analysis.confidenceA : analysis.confidenceB;

      stakesList.push({
        fight: `${fV} vs ${fA}`,
        pick: pickName,
        odds,
        prob,
        ev: evValue,
        confidence
      });
    }
  });

  if (stakesList.length === 0) {
    container.innerHTML = `<div class="empty" style="padding: 24px;"><div class="empty-icon">💸</div>Nenhum palpite recomendado com valor esperado positivo (EV+) para este card.</div>`;
    return;
  }

  let htmlRows = '';
  stakesList.forEach(p => {
    let stakeVal = 0;

    if (strategy === 'flat') {
      stakeVal = baseStake;
    } else if (strategy === 'kelly') {
      const kellyFrac = (p.prob * p.odds - 1) / (p.odds - 1);
      if (kellyFrac > 0) {
        stakeVal = bankroll * kellyFrac * kellyFraction;
      }
      // Limite defensivo de 15% da banca por aposta
      stakeVal = Math.min(stakeVal, bankroll * 0.15);
    } else if (strategy === 'ev') {
      // Ajuste proporcional ao EV+ (considerando EV+ médio de 0.08)
      const mult = Math.max(0.25, Math.min(3.0, p.ev / 0.08));
      stakeVal = baseStake * mult;
    } else if (strategy === 'confidence') {
      // Ajuste proporcional à confiança (escala 50% a 100%)
      const mult = Math.max(0.3, Math.min(3.0, (p.confidence - 45) / 15));
      stakeVal = baseStake * mult;
    }

    stakeVal = Math.round(stakeVal * 100) / 100;
    if (stakeVal < 0) stakeVal = 0;

    const formattedStake = currency === 'R$' || currency === '$'
      ? `${currency} ${stakeVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${stakeVal} ${currency}`;

    const evCls = p.ev > 0 ? 'ev-pos' : p.ev < 0 ? 'ev-neg' : 'ev-neu';
    const confClass = p.confidence >= 70 ? 'badge-conf-h' : p.confidence >= 55 ? 'badge-conf-m' : 'badge-conf-l';

    htmlRows += `
      <tr>
        <td><strong>${p.fight}</strong></td>
        <td><span style="color:var(--gold);font-weight:700">🥊 ${p.pick}</span></td>
        <td style="font-weight:600">${p.odds.toFixed(2)}</td>
        <td>${(p.prob * 100).toFixed(1)}%</td>
        <td class="${evCls}">${(p.ev >= 0 ? '+' : '')}${p.ev.toFixed(3)}</td>
        <td><span class="badge ${confClass}">${p.confidence}%</span></td>
        <td style="font-size:15px;font-weight:900;color:var(--green)">${formattedStake}</td>
      </tr>
    `;
  });

  container.innerHTML = `
    <div class="ev-table-wrap">
      <table class="odds-cat-table">
        <thead>
          <tr>
            <th>Luta</th>
            <th>Palpite</th>
            <th>Odds</th>
            <th>Prob. Ajustada</th>
            <th>EV+</th>
            <th>Confiança</th>
            <th>Aposta Sugerida</th>
          </tr>
        </thead>
        <tbody>
          ${htmlRows}
        </tbody>
      </table>
    </div>
  `;
}

// ── BANCO DINÂMICO DE LUTADORES (MODAL & SALVAMENTO) ─────────────
let _currentEditingFighter = null;

function openFighterModal(name) {
  _currentEditingFighter = name;
  const nameInput = document.getElementById('fighter-name');
  if (nameInput) nameInput.value = name;

  const data = getFighterData(name);
  const hInput = document.getElementById('fighter-height');
  const rInput = document.getElementById('fighter-reach');
  const stInput = document.getElementById('fighter-stance');
  const syInput = document.getElementById('fighter-style');

  if (data) {
    if (hInput) hInput.value = data.height_cm || '';
    if (rInput) rInput.value = data.reach_cm || '';
    if (stInput) stInput.value = data.stance || 'Orthodox';
    if (syInput) syInput.value = data.style || 'All-Round';
  } else {
    if (hInput) hInput.value = '';
    if (rInput) rInput.value = '';
    if (stInput) stInput.value = 'Orthodox';
    if (syInput) syInput.value = 'All-Round';
  }

  const modal = document.getElementById('fighter-modal');
  if (modal) modal.classList.add('active');
}

function closeFighterModal() {
  const modal = document.getElementById('fighter-modal');
  if (modal) modal.classList.remove('active');
  _currentEditingFighter = null;
}

function saveFighterStats() {
  if (!_currentEditingFighter) return;

  const hVal = parseFloat(document.getElementById('fighter-height').value);
  const rVal = parseFloat(document.getElementById('fighter-reach').value);
  const stanceVal = document.getElementById('fighter-stance').value;
  const styleVal = document.getElementById('fighter-style').value;

  if (isNaN(hVal) || isNaN(rVal) || hVal < 100 || rVal < 100) {
    alert('Insira valores válidos de altura e envergadura (mínimo de 100 cm).');
    return;
  }

  saveCustomFighter(_currentEditingFighter, {
    height_cm: hVal,
    reach_cm: rVal,
    stance: stanceVal,
    style: styleVal
  });

  closeFighterModal();
  renderEvento();
}

// ── INIT ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const fighterModal = document.getElementById('fighter-modal');
  if (fighterModal) {
    fighterModal.addEventListener('click', e => {
      if (e.target === fighterModal) closeFighterModal();
    });
  }

  loadData();
});

// Event listener centralizado para modal de lutador
document.addEventListener('click', e => {
  const btn = e.target.closest('.fc-edit-btn');
  if (btn) openFighterModal(btn.dataset.fighter);
});
