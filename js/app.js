/**
 * 🥊 UFC BET ANALYZER — LÓGICA PRINCIPAL
 * Base local instantânea (121 eventos + 4.287 lutadores) com sync ao vivo ESPN/Odds API.
 */

const NULO    = ['NC','NO CONTEST','DRAW','EMPATE','SEM CONTEST'];

// ── ESTADO GLOBAL ────────────────────────────────────────────────
let _eventos   = [];
let _lutadores = {};
let _tipsters  = [];
let _zebraStats = {};
let _currentTab = 'futuros';
let _currentHistSubTab = 'overview';
let _cardFilter = { search: '', quick: 'all' };
let _myTickets = {};
let _myBetsHistory = [];
try {
  _myTickets = JSON.parse(localStorage.getItem('ufc_my_tickets_v1') || '{}') || {};
} catch (e) { _myTickets = {}; }
try {
  _myBetsHistory = JSON.parse(localStorage.getItem('ufc_my_bets_history_v1') || '[]') || [];
} catch (e) { _myBetsHistory = []; }

window._espnApiAvailable = true;

// Fila Inteligente ESPN (Sem travar a UI com skeletons infinitos)
window._espnQueue = [];
window._espnProcessing = false;
window._fetchingEspn = {};
window._processEspnQueue = async function() {
  if (!window._espnApiAvailable || window._espnProcessing || window._espnQueue.length === 0) {
    window._espnQueue = [];
    return;
  }
  window._espnProcessing = true;

  const batch = [...new Set(window._espnQueue.splice(0, 6))];
  try {
    await Promise.allSettled(batch.map(async (fighter) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const r = await fetch(`/api/get-fighter-espn?name=${encodeURIComponent(fighter)}`, { signal: controller.signal });
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          window._espnApiAvailable = false;
          window._fetchingEspn[fighter] = 'not_found';
          return;
        }
        if (r.ok) {
          const data = await r.json();
          if (data.success && typeof saveCustomFighter === 'function') {
            const existingDb = (typeof getFighterData === 'function' ? getFighterData(fighter) : null) || {};
            saveCustomFighter(fighter, {
              ...existingDb,
              height_cm: data.height_cm || existingDb.height_cm,
              reach_cm: data.reach_cm || existingDb.reach_cm,
              stance: data.stance || existingDb.stance,
              wins: data.wins != null ? data.wins : existingDb.wins,
              losses: data.losses != null ? data.losses : existingDb.losses,
              draws: data.draws != null ? data.draws : existingDb.draws,
              espn_photo: data.photo || existingDb.espn_photo,
              espn_sync_done: true
            });
            window._fetchingEspn[fighter] = false;
            if (typeof refreshFighterCards === 'function') refreshFighterCards(fighter);
            return;
          }
        }
        window._fetchingEspn[fighter] = 'not_found';
        if (typeof saveCustomFighter === 'function') {
          const existingDb = (typeof getFighterData === 'function' ? getFighterData(fighter) : null) || {};
          saveCustomFighter(fighter, { ...existingDb, espn_sync_done: true });
        }
      } catch (e) {
        window._fetchingEspn[fighter] = 'not_found';
      } finally {
        clearTimeout(timer);
      }
    }));
  } finally {
    window._espnProcessing = false;
    if (window._espnApiAvailable && window._espnQueue.length > 0) {
      window._processEspnQueue();
    } else {
      window._espnQueue = [];
    }
  }
};

// Charts
let _roiChart = null, _compareChart = null, _styleChart = null;

// ── CARREGAMENTO INSTANTÂNEO + SINCRONIZAÇÃO EM BACKGROUND ───────
function hydrateFightersStylesFromDb() {
  if (typeof FIGHTERS_DB !== 'object' || !FIGHTERS_DB) return;
  Object.entries(FIGHTERS_DB).forEach(([k, info]) => {
    if (!info || !info.style) return;
    if (!_lutadores[k]) _lutadores[k] = info.style;
    const last = k.split(' ').pop();
    if (last && last.length > 3 && !_lutadores[last]) _lutadores[last] = info.style;
  });
}

function parseBrDateMs(s) {
  if (!s) return 0;
  const str = String(s).trim();
  if (str.includes('/')) {
    const p = str.split('/');
    if (p.length === 3) return new Date(`${p[2]}-${p[1]}-${p[0]}T12:00:00`).getTime() || 0;
  }
  const ms = Date.parse(str);
  return Number.isNaN(ms) ? 0 : ms;
}

function normalizeTitleStr(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function orderCardMainFirst(cardLutas, eventName) {
  if (!Array.isArray(cardLutas) || cardLutas.length === 0) return cardLutas || [];
  if (cardLutas.length > 1) {
    const title = normalizeTitleStr(eventName);
    const m = title.match(/(?:ufc\s+\d+|fn|fight night|noche ufc)[a-z0-9\s]*\s([a-z0-9']+)\s+vs\s+([a-z0-9']+)/i)
      || title.match(/([a-z0-9']+)\s+vs\s+([a-z0-9']+)/i);
    if (m) {
      const tokA = m[1].trim();
      const tokB = m[2].trim().replace(/\d+$/, '');
      const isHeadliner = c => {
        const pair = normalizeTitleStr(`${c.fV || ''} ${c.fA || ''}`);
        return (tokA.length > 2 && pair.includes(tokA)) && (tokB.length > 2 && pair.includes(tokB));
      };
      const idx = cardLutas.findIndex(isHeadliner);
      if (idx >= cardLutas.length / 2) {
        cardLutas.reverse();
      }
      const newIdx = cardLutas.findIndex(isHeadliner);
      if (newIdx > 0) {
        const [mainFight] = cardLutas.splice(newIdx, 1);
        cardLutas.unshift(mainFight);
      }
    }
  }
  cardLutas.forEach((c, idx) => {
    c.cardSegment = idx === 0
      ? '🏆 Luta Principal'
      : idx === 1
        ? '🔥 Co-Main Event'
        : idx < 5
          ? 'Card Principal'
          : 'Card Preliminar';
  });
  return cardLutas;
}

function getFighterEloCtx(fV, fA, fightObj) {
  if (fightObj && fightObj._eloCtx) return fightObj._eloCtx;
  const kA = String(fV || '').toLowerCase().trim();
  const kB = String(fA || '').toLowerCase().trim();
  return {
    eloA: (window._fighterElo && window._fighterElo[kA]) || 1500,
    eloB: (window._fighterElo && window._fighterElo[kB]) || 1500,
    streakA: (window._fighterStreak && window._fighterStreak[kA]) || 0,
    streakB: (window._fighterStreak && window._fighterStreak[kB]) || 0
  };
}

function ensureAllEventsAnalyzed() {
  const activePicks = [];
  const baseZebraStats = computeOddsCatsGeral();
  const eloMap = {};
  const streakMap = {};

  // Ordenar eventos cronologicamente (do mais antigo ao mais recente) para evitar vazamento futuro no Elo
  const chronoEvents = [..._eventos].sort((a, b) => parseBrDateMs(a.dataEvento) - parseBrDateMs(b.dataEvento));

  chronoEvents.forEach(ev => {
    if (!ev.cardLutas) ev.cardLutas = [];
    if (!ev.lutas) ev.lutas = [];
    if (!ev.oddCard) ev.oddCard = {};

    orderCardMainFirst(ev.cardLutas, ev.nome);

    // Popular oddCard se ainda estiver vazio
    ev.cardLutas.forEach(c => {
      if (c.fV && c.oV) ev.oddCard[c.fV.toLowerCase()] = c.oV;
      if (c.fA && c.oA) ev.oddCard[c.fA.toLowerCase()] = c.oA;
    });

    ev.punterAnalise = [];
    const evPicks = [];

    if (typeof analyzeFight === 'function') {
      ev.cardLutas.forEach(c => {
        if (!c.fV || !c.fA) return;
        const kA = c.fV.toLowerCase().trim();
        const kB = c.fA.toLowerCase().trim();
        const eloCtx = {
          eloA: eloMap[kA] || 1500,
          eloB: eloMap[kB] || 1500,
          streakA: streakMap[kA] || 0,
          streakB: streakMap[kB] || 0
        };
        c._eloCtx = eloCtx;

        const dbA = typeof getFighterData === 'function' ? getFighterData(c.fV) : null;
        const dbB = typeof getFighterData === 'function' ? getFighterData(c.fA) : null;
        const an = analyzeFight(c.fV, c.fA, c.oV, c.oA, dbA, dbB, baseZebraStats, eloCtx);
        if (!an || !an.pickRecommended) return;

        // Atualizar Elo e Momentum APÓS calcular a previsão desta luta (se a luta já tiver resultado)
        const lutaRes = findLuta(ev, c.fV) || findLuta(ev, c.fA);
        if (lutaRes && lutaRes.resultado && !NULO.some(x => lutaRes.resultado.toUpperCase().includes(x))) {
          const resLow = lutaRes.resultado.toLowerCase();
          const lastV = kA.split(' ').pop();
          const lastA = kB.split(' ').pop();
          const f1Won = (lastV && resLow.includes(lastV)) || resLow === kA;
          const f2Won = !f1Won && ((lastA && resLow.includes(lastA)) || resLow === kB);
          if (f1Won || f2Won) {
            const expA = 1 / (1 + Math.pow(10, (eloCtx.eloB - eloCtx.eloA) / 400));
            eloMap[kA] = eloCtx.eloA + 32 * ((f1Won ? 1 : 0) - expA);
            eloMap[kB] = eloCtx.eloB + 32 * ((f2Won ? 1 : 0) - (1 - expA));
            streakMap[kA] = f1Won ? (eloCtx.streakA > 0 ? eloCtx.streakA + 1 : 1) : (eloCtx.streakA < 0 ? eloCtx.streakA - 1 : -1);
            streakMap[kB] = f2Won ? (eloCtx.streakB > 0 ? eloCtx.streakB + 1 : 1) : (eloCtx.streakB < 0 ? eloCtx.streakB - 1 : -1);
          }
        }

        const phys = an.physical || {};
        const advParts = [];
        if (phys.reachDiff) advParts.push(`Env ${phys.reachDiff > 0 ? '+' : ''}${phys.reachDiff}cm`);
        if (phys.heightDiff) advParts.push(`Alt ${phys.heightDiff > 0 ? '+' : ''}${phys.heightDiff}cm`);
        if (Math.abs(eloCtx.eloA - eloCtx.eloB) >= 15) {
          advParts.push(`Elo ${Math.round(eloCtx.eloA)}×${Math.round(eloCtx.eloB)}`);
        }
        const isPickV = an.pickRecommended.toLowerCase() === c.fV.toLowerCase();
        const pickProb = isPickV ? an.probAdjA : an.probAdjB;
        const impProb = isPickV ? an.probImplA : an.probImplB;

        const pmRow = {
          luta: `${c.fV} vs ${c.fA}`,
          fisico: advParts.length ? advParts.join(' · ') : 'Equilibrado',
          probImp: impProb ? `${(impProb * 100).toFixed(0)}%` : '50%',
          probReal: `${(pickProb * 100).toFixed(1)}%`,
          ev: an.pickIsEstimate ? 'CONSENSO' : `${an.pickEV >= 0 ? '+' : ''}${an.pickEV.toFixed(3)}`,
          pick: an.pickRecommended,
          met: an.predictedMethod || 'Decisão',
          nota: an.isHighPrecisionPick
            ? `🎯 Alta Precisão (${an.pickConf}% prob · borda ${(an.multiFactorEdge * 100).toFixed(1)}%)`
            : `Base Estatística (${an.pickConf}%)`
        };

        // Na tabela oficial de Picks / ROI histórico entram apenas os Picks Oficiais de Alta Precisão (evita lutas 50/50!)
        if (an.isHighPrecisionPick || ev.isFuturo) {
          if (an.isHighPrecisionPick) {
            ev.punterAnalise.push(pmRow);
          }
        }
        evPicks.push({
          ...pmRow,
          odd: isPickV ? c.oV : c.oA,
          evNum: an.pickEV || 0,
          conf: an.pickConf || 50,
          highPrecision: an.isHighPrecisionPick
        });
      });

      // Fallback para eventos passados/futuros sem nenhum pick acima do corte
      if (ev.punterAnalise.length === 0 && evPicks.length > 0) {
        const best = [...evPicks].sort((a, b) => (b.conf - a.conf) || (b.evNum - a.evNum))[0];
        if (best) ev.punterAnalise.push(best);
      }

      // Gerar sugestões de Simples / Dupla / Tripla priorizando picks de Alta Precisão
      if (evPicks.length > 0) {
        const sortedPicks = [...evPicks].sort((a, b) =>
          (Number(b.highPrecision) - Number(a.highPrecision)) ||
          (b.conf - a.conf) ||
          (b.evNum - a.evNum)
        );
        const top1 = sortedPicks[0];
        const top2 = sortedPicks.slice(0, 2);
        const top3 = sortedPicks.slice(0, 3);
        const multOdd = arr => {
          const valid = arr.map(x => Number(x.odd)).filter(o => o > 1);
          if (valid.length !== arr.length) return '—';
          return valid.reduce((acc, o) => acc * o, 1).toFixed(2);
        };
        ev.apostas = {
          simples: top1 ? {
            tipo: '🎯 Simples Principal (Alta Precisão)',
            selecao: top1.pick,
            odd: top1.odd ? Number(top1.odd).toFixed(2) : 'Est.',
            nota: top1.nota
          } : {},
          dupla: top2.length >= 2 ? {
            tipo: '⚡ Dupla Sugerida',
            selecao: top2.map(x => x.pick.split(' ').pop()).join(' + '),
            odd: multOdd(top2),
            nota: `2 seleções de maior convergência`
          } : {},
          tripla: top3.length >= 3 ? {
            tipo: '🚀 Tripla Conservadora',
            selecao: top3.map(x => x.pick.split(' ').pop()).join(' + '),
            odd: multOdd(top3),
            nota: `3 seleções de maior probabilidade`
          } : {}
        };
      }
    }

    // Coletar picks ativos de eventos futuros para o Assistente de IA
    if (ev.isFuturo) {
      ev.punterAnalise.forEach(pm => {
        if (pm.pick) {
          activePicks.push({ event: ev.nome, fight: pm.luta, pick: pm.pick, ev: pm.ev, met: pm.met });
        }
      });
    }
  });

  window._fighterElo = eloMap;
  window._fighterStreak = streakMap;
  window._activePicks = activePicks;
  _zebraStats = baseZebraStats;
}

function setSyncStatus(text, state = 'ok') {
  const el = document.getElementById('sync-status-pill');
  if (!el) return;
  el.textContent = text;
  el.className = `sync-pill sync-${state}`;
}

async function fetchPublicEspnScoreboardDirect() {
  const now = new Date();
  const fmt = d => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
  const start = new Date(now.getTime() - 21 * 86400000);
  const end = new Date(now.getTime() + 90 * 86400000);
  const url = `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${fmt(start)}-${fmt(end)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const am2dec = ml => {
      const n = Number(ml);
      if (!Number.isFinite(n) || n === 0) return null;
      return n > 0 ? +(1 + n / 100).toFixed(2) : +(1 + 100 / Math.abs(n)).toFixed(2);
    };
    return (data.events || []).map(ev => ({
      id: ev.id,
      name: ev.name,
      shortName: ev.shortName,
      date: ev.date,
      completed: Boolean(ev.status?.type?.completed),
      fights: (ev.competitions || []).map((comp, idx) => {
        const compOdds = comp.odds?.[0] || null;
        const homeMl = compOdds?.homeTeamOdds?.moneyLine;
        const awayMl = compOdds?.awayTeamOdds?.moneyLine;
        const fighters = (comp.competitors || []).map((f, fIdx) => {
          const ath = f.athlete || {};
          const fullName = ath.displayName || ath.fullName || 'Unknown';
          const local = typeof getFighterData === 'function' ? (getFighterData(fullName) || {}) : {};
          const odd = fIdx === 0 ? am2dec(homeMl) : am2dec(awayMl);
          return {
            id: f.id,
            name: fullName,
            shortName: ath.shortName || fullName,
            photo: ath.headshot?.href || (f.id ? `https://a.espncdn.com/combiner/i?img=/i/headshots/mma/players/full/${f.id}.png` : ''),
            record: f.records?.[0]?.summary || '0-0-0',
            winner: Boolean(f.winner),
            odd,
            height_cm: local.height_cm || 0,
            reach_cm: local.reach_cm || 0,
            stance: local.stance || '',
            style: local.style || 'MMA'
          };
        });
        const state = comp.status?.type?.state || 'pre';
        return {
          id: comp.id || `${ev.id}-${idx}`,
          date: comp.date || ev.date,
          status: state,
          completed: Boolean(comp.status?.type?.completed) || state === 'post',
          method: comp.details?.[0]?.type?.text || comp.status?.type?.shortDetail || '',
          cardSegment: comp.cardSegment?.description || (idx === 0 ? 'Main Event' : ''),
          weightClass: comp.type?.abbreviation || comp.type?.text || '',
          odds: compOdds ? { details: compOdds.details || 'Sem odds', oddA: fighters[0]?.odd, oddB: fighters[1]?.odd } : null,
          fighters
        };
      })
    }));
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function syncEspnInBackground() {
  setSyncStatus('🔄 Sincronizando ESPN…', 'loading');
  let espnEvents = null;

  // 1) Tenta endpoint serverless (/api/get-espn-events)
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch('/api/get-espn-events', { signal: ctrl.signal });
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.includes('application/json')) {
      const json = await r.json();
      if (json.success && Array.isArray(json.events)) {
        espnEvents = json.events;
      }
    }
  } catch (e) {
    // fallback direto abaixo
  } finally {
    clearTimeout(t);
  }

  // 2) Fallback direto via API pública ESPN (sem depender de backend/Sheets)
  if (!espnEvents) {
    espnEvents = await fetchPublicEspnScoreboardDirect();
  }

  if (espnEvents && espnEvents.length > 0) {
    integrateEspnEvents(espnEvents);
    ensureAllEventsAnalyzed();
    const stats = computeStats();
    renderKPIs(stats);
    renderPerfStats(stats);
    renderROICompare(stats);
    renderApostasROI();
    renderAllPicks();
    renderMyBetsHistory();
    renderOddsCats();
    renderOddsCatsGeral();
    populateEventSelector(_currentTab);
    setSyncStatus(`🟢 ESPN ao vivo (${espnEvents.length} cards)`, 'ok');
  } else {
    setSyncStatus(`⚡ Base Local (${_eventos.length} eventos)`, 'local');
  }

  await syncLiveOddsInBackground();
}

function normOddName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function syncLiveOddsInBackground() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch('/api/get-mma-odds', { signal: ctrl.signal });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.includes('application/json')) return;
    const json = await r.json();
    if (!json.success || !Array.isArray(json.matchups) || json.matchups.length === 0) return;

    let changed = 0;
    const futureEvents = _eventos.filter(e => e.isFuturo);
    for (const ev of futureEvents) {
      for (const c of (ev.cardLutas || [])) {
        const nV = normOddName(c.fV);
        const nA = normOddName(c.fA);
        const lV = nV.split(' ').pop();
        const lA = nA.split(' ').pop();
        const match = json.matchups.find(m => {
          const mA = normOddName(m.fighterA);
          const mB = normOddName(m.fighterB);
          return ((mA === nV || mA.endsWith(lV)) && (mB === nA || mB.endsWith(lA))) ||
                 ((mA === nA || mA.endsWith(lA)) && (mB === nV || mB.endsWith(lV)));
        });
        if (!match) continue;

        const direct = normOddName(match.fighterA) === nV || normOddName(match.fighterA).endsWith(lV);
        const newOV = direct ? match.oddA : match.oddB;
        const newOA = direct ? match.oddB : match.oddA;
        const newOpenV = direct ? match.openOddA : match.openOddB;
        const newOpenA = direct ? match.openOddB : match.openOddA;

        if (newOV && newOV > 1.01 && (!c.oV || Math.abs(c.oV - newOV) >= 0.02)) {
          c.oV = newOV;
          ev.oddCard[c.fV.toLowerCase()] = newOV;
          changed++;
        }
        if (newOA && newOA > 1.01 && (!c.oA || Math.abs(c.oA - newOA) >= 0.02)) {
          c.oA = newOA;
          ev.oddCard[c.fA.toLowerCase()] = newOA;
          changed++;
        }
        if (newOpenV) c.openOV = newOpenV;
        if (newOpenA) c.openOA = newOpenA;
      }
      if (changed > 0) ev.punterAnalise = [];
    }

    if (changed > 0) {
      ensureAllEventsAnalyzed();
      renderEvento();
      setSyncStatus(`🟢 ESPN + Odds (${json.source})`, 'ok');
    }
  } catch (e) {
    // falha silenciosa: base local / ESPN segue ativa
  } finally {
    clearTimeout(t);
  }
}

async function loadData() {
  try {
    hydrateFightersStylesFromDb();

    if (Array.isArray(window.INITIAL_EVENTS_DB) && window.INITIAL_EVENTS_DB.length > 0) {
      // Clonagem leve para evitar mutação do array global original
      _eventos = window.INITIAL_EVENTS_DB.map(ev => ({
        ...ev,
        cardLutas: (ev.cardLutas || []).map(c => ({ ...c })),
        lutas: (ev.lutas || []).map(l => ({ ...l })),
        punterAnalise: (ev.punterAnalise || []).map(p => ({ ...p })),
        oddCard: { ...(ev.oddCard || {}) }
      }));

      // Ordenar com segurança: mais recentes primeiro para consistência interna
      _eventos.sort((a, b) => parseBrDateMs(b.dataEvento) - parseBrDateMs(a.dataEvento));
    } else {
      loadDemoData();
    }

    ensureAllEventsAnalyzed();
    renderAll();
    setSyncStatus(`⚡ Base Local (${_eventos.length} eventos)`, 'local');

    // Sincronizar ESPN ao vivo em segundo plano sem bloquear a interface
    syncEspnInBackground();
  } catch (e) {
    console.error('loadData:', e);
    loadDemoData();
    ensureAllEventsAnalyzed();
    renderAll();
    setSyncStatus('⚡ Modo Offline', 'local');
  }
}

// ── INTEGRAÇÃO ESPN ───────────────────────────────────────────────
function integrateEspnEvents(espnEvents) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  espnEvents.forEach(espnEv => {
    const cardLutas = [];
    const oddCard = {};
    const lutas = [];

    (espnEv.fights || []).forEach((fight, idx) => {
      if (!fight.fighters || fight.fighters.length < 2) return;
      const f1 = fight.fighters[0];
      const f2 = fight.fighters[1];
      const oV = f1.odd || fight.odds?.oddA || null;
      const oA = f2.odd || fight.odds?.oddB || null;
      if (oV) oddCard[f1.name.toLowerCase()] = oV;
      if (oA) oddCard[f2.name.toLowerCase()] = oA;

      cardLutas.push({
        fV: f1.name,
        oV,
        f1Obj: f1,
        espnPhotoV: f1.photo,
        fA: f2.name,
        oA,
        f2Obj: f2,
        espnPhotoA: f2.photo,
        weightClass: fight.weightClass || '',
        cardSegment: fight.cardSegment || (idx === 0 ? 'Main Event' : ''),
        espnOdds: fight.odds ? fight.odds.details : null
      });

      const winFighter = fight.completed ? (f1.winner ? f1.name : f2.winner ? f2.name : '') : '';
      lutas.push({
        luta: `${f1.name} vs ${f2.name}`,
        picks: {},
        resultado: winFighter,
        metodo: fight.method || ''
      });
    });

    if (cardLutas.length === 0) return;

    // A ESPN envia em ordem cronológica (preliminares -> luta principal); garante Luta Principal no topo
    orderCardMainFirst(cardLutas, espnEv.name);

    const evDateObj = espnEv.date ? new Date(espnEv.date) : null;
    const isFuturoEspn = Boolean(!espnEv.completed && evDateObj && evDateObj >= new Date(hoje.getTime() - 12 * 3600000));
    const dataStr = evDateObj && !isNaN(evDateObj.getTime())
      ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(evDateObj)
      : '';

    const baseName = espnEv.name.split(':')[0].trim().toLowerCase();
    const isNumberedPpv = /^ufc\s+\d+$/i.test(baseName);
    const existingIdx = _eventos.findIndex(e => {
      const en = (e.nome || '').toLowerCase();
      return en === espnEv.name.toLowerCase() || (isNumberedPpv && en.startsWith(baseName));
    });

    if (existingIdx >= 0) {
      const ex = _eventos[existingIdx];
      const oldLutas = ex.cardLutas || [];
      cardLutas.forEach(espnLuta => {
        const fVLast = espnLuta.fV.toLowerCase().split(' ').pop();
        const fALast = espnLuta.fA.toLowerCase().split(' ').pop();
        const sl = oldLutas.find(l =>
          (l.fV && l.fV.toLowerCase().includes(fVLast)) ||
          (l.fA && l.fA.toLowerCase().includes(fALast))
        );
        if (sl) {
          if (sl.fV && sl.fV.toLowerCase().includes(fVLast)) {
            if (!espnLuta.oV) espnLuta.oV = sl.oV;
            if (!espnLuta.oA) espnLuta.oA = sl.oA;
          } else {
            if (!espnLuta.oV) espnLuta.oV = sl.oA;
            if (!espnLuta.oA) espnLuta.oA = sl.oV;
          }
          if (!espnLuta.weightClass) espnLuta.weightClass = sl.weightClass || '';
        }
      });

      ex.cardLutas = cardLutas;
      ex.oddCard = { ...ex.oddCard, ...oddCard };
      if (!ex.lutas || ex.lutas.length === 0) ex.lutas = lutas;
      else if (espnEv.completed) {
        lutas.forEach(nl => {
          if (!nl.resultado) return;
          const lastW = nl.resultado.toLowerCase().split(' ').pop();
          const match = ex.lutas.find(ol => ol.luta.toLowerCase().includes(lastW));
          if (match) { match.resultado = nl.resultado; match.metodo = nl.metodo || match.metodo; }
        });
      }
      ex.isEspn = true;
      ex.isFuturo = isFuturoEspn;
      ex.concluido = !isFuturoEspn;
      if (dataStr) ex.dataEvento = dataStr;
      // Recalcular PunterMind caso o card tenha mudado
      ex.punterAnalise = [];
    } else {
      _eventos.unshift({
        nome: espnEv.name,
        dataEvento: dataStr,
        cardLutas,
        oddCard,
        lutas,
        punterAnalise: [],
        apostas: null,
        concluido: !isFuturoEspn,
        isFuturo: isFuturoEspn,
        isEspn: true
      });
    }
  });
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
  _eventos.filter(e => !e.isFuturo).forEach(ev => {
    (ev.punterAnalise || []).forEach(pm => {
      if (!pm.pick) return;
      const luta = findLuta(ev, pm.pick);
      if (!luta || !luta.resultado) return;
      if (NULO.some(x => luta.resultado.toUpperCase().includes(x))) return;
      const odds = findOdds(ev.oddCard, pm.pick);
      if (!odds || odds <= 1.0 || odds > 20) return;
      const cat = getOddsCat(odds);
      if (!cat) return;
      stats[cat.key].picks++;
      const pickL = pm.pick.toLowerCase().split(' ').pop();
      const acertou = luta.resultado.toLowerCase().includes(pickL);
      stats[cat.key].roi += acertou ? (odds - 1) : -1;
      if (acertou) stats[cat.key].acertos++;
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

  const pastChrono = _eventos
    .filter(e => !e.isFuturo)
    .sort((a, b) => parseBrDateMs(a.dataEvento) - parseBrDateMs(b.dataEvento));

  pastChrono.forEach(ev => {
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

    // 🔒 Locks de Elite (probAdj >= 70% + vantagem técnica positiva)
    (ev.cardLutas || []).forEach(c => {
      if (!c.fV || !c.fA || !c.oV || !c.oA || typeof analyzeFight !== 'function') return;
      const luta = findLuta(ev, c.fV) || findLuta(ev, c.fA);
      if (!luta || !luta.resultado) return;
      if (NULO.some(x => luta.resultado.toUpperCase().includes(x))) return;
      const dbA = typeof getFighterData === 'function' ? getFighterData(c.fV) : null;
      const dbB = typeof getFighterData === 'function' ? getFighterData(c.fA) : null;
      const an = analyzeFight(c.fV, c.fA, c.oV, c.oA, dbA, dbB, _zebraStats, c._eloCtx);
      if (!an || !an.pickRecommended) return;
      const isV = an.pickRecommended.toLowerCase() === c.fV.toLowerCase();
      const prob = isV ? an.probAdjA : an.probAdjB;
      const odds = isV ? c.oV : c.oA;
      if (prob < 0.70 || an.multiFactorEdge < 0.01 || !odds || odds <= 1.01) return;
      lockPicks++;
      const pickL = an.pickRecommended.toLowerCase().split(' ').pop();
      const acertou = luta.resultado.toLowerCase().includes(pickL);
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
  const pastChrono = _eventos
    .filter(e => !e.isFuturo)
    .sort((a, b) => parseBrDateMs(a.dataEvento) - parseBrDateMs(b.dataEvento));
  pastChrono.forEach(ev => {
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
  if (typeof renderMyBetsHistory === 'function') renderMyBetsHistory();
  // renderCompareChart moved to switchTab
  renderOddsCats();
  renderOddsCatsGeral();
  // renderStyleStats moved to switchTab
}

function renderEmpty() {
  document.getElementById('loading').innerHTML = '<div class="empty"><div class="empty-icon">📭</div>Nenhum evento encontrado.</div>';
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
    { label: '🥊 PunterMMA', cls: '', roi: parseFloat(s.pmROI), pct: parseFloat(s.pmROIPct) || 0, picks: s.pmPicks, acertos: s.pmAcertos, desc: 'Picks oficiais de Alta Precisão (Elo + De-Vig)' },
    { label: '🔒 Locks de Elite (70%+)', cls: 'purple', roi: parseFloat(s.lockROI), pct: parseFloat(s.lockROIPct) || 0, picks: s.lockPicks, acertos: s.lockAcertos, desc: 'Picks com prob. ≥ 70% e borda técnica positiva' },
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
        { label: '🔒 Locks de Elite', data: s.lockH.map(h => h.cum), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.06)', borderWidth: 2.5, pointRadius: 3, fill: false, tension: 0.35 },
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
  const pastChrono = _eventos
    .filter(e => !e.isFuturo)
    .sort((a, b) => parseBrDateMs(a.dataEvento) - parseBrDateMs(b.dataEvento));

  pastChrono.forEach(ev => {
    let picks = 0, acertos = 0, evLucro = 0;
    (ev.punterAnalise || []).forEach(pm => {
      if (!pm.pick) return;
      const luta = findLuta(ev, pm.pick);
      if (!luta || !luta.resultado) return;
      if (NULO.some(x => luta.resultado.toUpperCase().includes(x))) return;
      const odds = findOdds(ev.oddCard, pm.pick);
      if (!odds) return;
      const pickL = pm.pick.toLowerCase().split(' ').pop();
      const acertou = luta.resultado.toLowerCase().includes(pickL);
      picks++;
      evLucro += acertou ? STAKE * (odds - 1) : -STAKE;
      if (acertou) acertos++;
    });
    if (!picks) return;
    cumLucro += evLucro;
    evRows.push({ evento: ev.nome, picks, acertos, erros: picks - acertos, investido: picks * STAKE, evLucro: Math.round(evLucro), cum: Math.round(cumLucro) });
  });
  evRows.reverse();
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

function saveMyTickets() {
  try { localStorage.setItem('ufc_my_tickets_v1', JSON.stringify(_myTickets)); } catch (e) {}
}

function saveMyBetsHistory() {
  try { localStorage.setItem('ufc_my_bets_history_v1', JSON.stringify(_myBetsHistory)); } catch (e) {}
}

function getTicketKey(evName, fV, fA) {
  return `${evName}::${fV} vs ${fA}`;
}

function toggleMyPick(evName, fV, fA, pick, odd, isZebra, evVal) {
  const key = getTicketKey(evName, fV, fA);
  if (_myTickets[key] && _myTickets[key].pick === pick) {
    delete _myTickets[key];
    _myBetsHistory = _myBetsHistory.filter(b => b.key !== key);
  } else {
    const entry = {
      key,
      eventName: evName,
      fightLabel: `${fV} vs ${fA}`,
      pick,
      odd: Number(odd) || null,
      isZebra: Boolean(isZebra),
      ev: Number(evVal) || 0,
      createdAt: new Date().toISOString()
    };
    _myTickets[key] = entry;
    const existingIdx = _myBetsHistory.findIndex(b => b.key === key);
    if (existingIdx >= 0) _myBetsHistory[existingIdx] = entry;
    else _myBetsHistory.unshift(entry);
  }
  saveMyTickets();
  saveMyBetsHistory();
  renderEvento();
  renderMyTicketBar();
  renderMyBetsHistory();
}

function removeMyPick(key) {
  delete _myTickets[key];
  saveMyTickets();
  renderEvento();
  renderMyTicketBar();
}

function clearMyTickets() {
  _myTickets = {};
  saveMyTickets();
  renderEvento();
  renderMyTicketBar();
}

function removeBetFromHistory(key) {
  _myBetsHistory = _myBetsHistory.filter(b => b.key !== key);
  delete _myTickets[key];
  saveMyTickets();
  saveMyBetsHistory();
  renderEvento();
  renderMyTicketBar();
  renderMyBetsHistory();
}

function clearMyBetsHistory() {
  _myBetsHistory = [];
  saveMyBetsHistory();
  renderMyBetsHistory();
}

function copyMyTicketToClipboard() {
  const entries = Object.entries(_myTickets);
  if (!entries.length) return '';

  const validOdds = entries.map(([, t]) => t.odd).filter(o => o && o > 1);
  const parlayOdd = validOdds.length > 0 ? validOdds.reduce((acc, o) => acc * o, 1) : null;
  const baseStake = parseFloat(document.getElementById('bk-base-stake')?.value) || 100;
  const currency = document.getElementById('bk-currency')?.value || 'R$';

  const lines = [
    `🥊 *Meu Bilhete UFC Bet Analyzer* (${entries.length} ${entries.length === 1 ? 'seleção' : 'seleções'})`,
    ''
  ];
  entries.forEach(([, t], i) => {
    const oddTxt = t.odd ? ` @ ${t.odd.toFixed(2)}` : '';
    const zebraTxt = t.isZebra ? ' 🦓' : '';
    lines.push(`${i + 1}. *${t.pick}*${oddTxt}${zebraTxt} (${t.fightLabel} · ${t.eventName})`);
  });
  if (parlayOdd) {
    lines.push('');
    lines.push(`📊 Odd Múltipla: *${parlayOdd.toFixed(2)}x*`);
    lines.push(`💰 Stake Base: ${currency} ${baseStake.toFixed(2)} → Retorno: *${currency} ${(baseStake * parlayOdd).toFixed(2)}*`);
  }

  const text = lines.join('\n');
  window._lastCopiedTicketText = text;
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  const btn = document.getElementById('copy-ticket-btn');
  if (btn) {
    const old = btn.textContent;
    btn.textContent = '✅ Copiado!';
    setTimeout(() => { btn.textContent = old; }, 2000);
  }
  return text;
}

function evaluateMyBetsHistory() {
  let greens = 0, reds = 0, pendentes = 0, roiUnits = 0;
  const rows = _myBetsHistory.map(item => {
    const ev = _eventos.find(e => e.nome === item.eventName);
    const odd = Number(item.odd) || 1.90;
    let status = 'PENDENTE';
    let lucro = 0;

    if (ev && !ev.isFuturo && item.pick) {
      const luta = findLuta(ev, item.pick);
      if (luta && luta.resultado && !NULO.some(x => luta.resultado.toUpperCase().includes(x))) {
        const pickLast = item.pick.toLowerCase().split(' ').pop();
        const hit = luta.resultado.toLowerCase().includes(pickLast);
        status = hit ? 'GREEN' : 'RED';
        lucro = hit ? (odd - 1) : -1;
        roiUnits += lucro;
        if (hit) greens++; else reds++;
      } else {
        pendentes++;
      }
    } else {
      pendentes++;
    }

    return { ...item, odd, status, lucro };
  });

  const settled = greens + reds;
  const hitRate = settled > 0 ? +((greens / settled) * 100).toFixed(1) : 0;
  const roiPct = settled > 0 ? +((roiUnits / settled) * 100).toFixed(1) : 0;
  return { rows, total: rows.length, settled, greens, reds, pendentes, roiUnits: +roiUnits.toFixed(2), hitRate, roiPct };
}

function renderMyBetsHistory() {
  const container = document.getElementById('my-bets-history-container');
  if (!container) return;

  const summary = evaluateMyBetsHistory();
  if (!summary.total) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">🎟️</div>Você ainda não salvou nenhum palpite. Clique em <strong>"Palpitar"</strong> em qualquer card de luta para acompanhar seu ROI pessoal aqui.</div>`;
    return;
  }

  const roiCls = summary.roiUnits > 0 ? 'roi-pos' : summary.roiUnits < 0 ? 'roi-neg' : 'roi-neu';
  const kpiHtml = `
    <div class="my-bets-summary">
      <div class="stat-card"><div class="stat-label">Palpites Salvos</div><div class="stat-val" style="color:var(--cyan)">${summary.total}</div><div class="stat-sub">${summary.pendentes} pendentes</div></div>
      <div class="stat-card"><div class="stat-label">Greens / Reds</div><div class="stat-val"><span style="color:var(--green)">${summary.greens}</span> / <span style="color:var(--red)">${summary.reds}</span></div><div class="stat-sub">${summary.settled} finalizadas</div></div>
      <div class="stat-card"><div class="stat-label">Acerto Pessoal</div><div class="stat-val" style="color:var(--gold)">${summary.settled ? summary.hitRate + '%' : '—'}</div><div class="stat-sub">Apuração automática</div></div>
      <div class="stat-card"><div class="stat-label">ROI Pessoal (1u/pick)</div><div class="stat-val ${roiCls}">${summary.roiUnits >= 0 ? '+' : ''}${summary.roiUnits.toFixed(2)}u</div><div class="stat-sub">${summary.settled ? (summary.roiPct >= 0 ? '+' : '') + summary.roiPct + '% yield' : 'Aguardando resultados'}</div></div>
    </div>
  `;

  const tableRows = summary.rows.map(b => {
    const statusBadge = b.status === 'GREEN'
      ? '<span class="badge badge-win">✅ Green</span>'
      : b.status === 'RED'
        ? '<span class="badge badge-ev-n">❌ Red</span>'
        : '<span style="color:var(--text3);font-size:12px">⏳ Pendente</span>';
    const lucroTxt = b.status === 'PENDENTE'
      ? '—'
      : `<span class="${b.lucro >= 0 ? 'roi-pos' : 'roi-neg'}">${b.lucro >= 0 ? '+' : ''}${b.lucro.toFixed(2)}u</span>`;
    return `<tr>
      <td style="font-size:12px;color:var(--text2)">${escHtml(b.eventName)}</td>
      <td style="font-weight:600">${escHtml(b.fightLabel)}</td>
      <td style="color:var(--gold);font-weight:700">🥊 ${escHtml(b.pick)}</td>
      <td>${b.odd.toFixed(2)}</td>
      <td>${statusBadge}</td>
      <td>${lucroTxt}</td>
      <td><button type="button" class="ticket-chip-rm" onclick="removeBetFromHistory('${escHtml(b.key).replace(/'/g, "\\'")}')" title="Remover do histórico">&times;</button></td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    ${kpiHtml}
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      <button type="button" class="ticket-clear-btn" onclick="clearMyBetsHistory()">Limpar Histórico Pessoal</button>
    </div>
    <div class="ev-table-wrap">
      <table class="odds-cat-table">
        <thead><tr><th>Evento</th><th>Luta</th><th>Seu Palpite</th><th>Odd</th><th>Status</th><th>Lucro (1u)</th><th></th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function setQuickFilter(mode) {
  _cardFilter.quick = mode;
  document.querySelectorAll('.qf-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.qf === mode);
  });
  renderEvento();
}

function setCardSearch(val) {
  _cardFilter.search = String(val || '').trim().toLowerCase();
  renderEvento();
}

function renderMyTicketBar() {
  const bar = document.getElementById('my-ticket-bar');
  if (!bar) return;
  const entries = Object.entries(_myTickets);
  if (entries.length === 0) {
    bar.innerHTML = '';
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'block';
  const validOdds = entries.map(([, t]) => t.odd).filter(o => o && o > 1);
  const parlayOdd = validOdds.length > 0 ? validOdds.reduce((acc, o) => acc * o, 1) : null;
  const baseStake = parseFloat(document.getElementById('bk-base-stake')?.value) || 100;
  const currency = document.getElementById('bk-currency')?.value || 'R$';

  const chipsHtml = entries.map(([key, t]) => `
    <span class="ticket-chip">
      <span>🥊 <strong>${escHtml(t.pick)}</strong>${t.odd ? ` <small>@${t.odd.toFixed(2)}</small>` : ''}</span>
      <button type="button" class="ticket-chip-rm" data-rm-ticket="${escHtml(key)}" title="Remover">&times;</button>
    </span>
  `).join('');

  bar.innerHTML = `
    <div class="ticket-bar-inner">
      <div class="ticket-bar-left">
        <div class="ticket-bar-title">🎟️ Meu Bilhete (${entries.length} ${entries.length === 1 ? 'luta' : 'lutas'})</div>
        <div class="ticket-chips">${chipsHtml}</div>
      </div>
      <div class="ticket-bar-right">
        ${parlayOdd ? `<div class="ticket-stat"><span>Odd Múltipla</span><strong>${parlayOdd.toFixed(2)}x</strong></div>` : ''}
        ${parlayOdd ? `<div class="ticket-stat"><span>Retorno (${currency} ${baseStake})</span><strong style="color:var(--green)">${currency} ${(baseStake * parlayOdd).toFixed(2)}</strong></div>` : ''}
        <button type="button" id="copy-ticket-btn" class="ticket-action-btn" onclick="copyMyTicketToClipboard()">📋 Copiar Bilhete</button>
        <button type="button" class="ticket-action-btn" onclick="switchTab('historico'); switchHistSubTab('mybets')">📊 Ver Meu ROI</button>
        <button type="button" class="ticket-clear-btn" onclick="clearMyTickets()">Limpar</button>
      </div>
    </div>
  `;
}

function renderEvento() {
  const sel = document.getElementById('evento-sel');
  if (!sel) return;
  const nome = sel.value;
  const ev = _eventos.find(e => e.nome === nome);
  const cardEl = document.getElementById('fight-cards-container');

  if (!ev) {
    document.getElementById('ev-meta').textContent = '';
    if (cardEl) {
      cardEl.innerHTML = _currentTab === 'futuros'
        ? '<div class="empty"><div class="empty-icon">📅</div>Nenhum evento futuro agendado no momento. Sincronizando calendário UFC…</div>'
        : '<div class="empty"><div class="empty-icon">🥊</div>Nenhum evento encontrado.</div>';
    }
    document.getElementById('ev-table-container').innerHTML = '';
    document.getElementById('ev-apostas-container').innerHTML = '';
    return;
  }

  const totalFights = (ev.cardLutas || []).length;
  const statusPill = ev.isFuturo ? '🟢 Próximo Card' : '🏁 Card Finalizado';
  document.getElementById('ev-meta').textContent = `${ev.dataEvento ? '📅 ' + ev.dataEvento + ' · ' : ''}${totalFights} lutas · ${statusPill}`;

  // Atualizar contadores nos filtros rápidos
  const cardAnalyses = (ev.cardLutas || []).map((c, idx) => {
    const dbA = typeof getFighterData === 'function' ? getFighterData(c.fV) : null;
    const dbB = typeof getFighterData === 'function' ? getFighterData(c.fA) : null;
    const eloCtx = getFighterEloCtx(c.fV, c.fA, c);
    const analysis = typeof analyzeFight === 'function' ? analyzeFight(c.fV, c.fA, c.oV, c.oA, dbA, dbB, _zebraStats, eloCtx) : null;
    const key = getTicketKey(ev.nome, c.fV, c.fA);
    return { c, idx, dbA, dbB, analysis, hasTicket: Boolean(_myTickets[key]) };
  });

  const qCounts = {
    all: cardAnalyses.length,
    precision: cardAnalyses.filter(x => x.analysis && x.analysis.isHighPrecisionPick).length,
    ev: cardAnalyses.filter(x => x.analysis && (x.analysis.evA > 0.03 || x.analysis.evB > 0.03)).length,
    zebra: cardAnalyses.filter(x => x.analysis && (x.analysis.zebraAlert || (x.c.oV >= 2.5 || x.c.oA >= 2.5))).length,
    ko: cardAnalyses.filter(x => x.analysis && /KO|TKO/i.test(x.analysis.predictedMethod || '')).length,
    sub: cardAnalyses.filter(x => x.analysis && /Sub/i.test(x.analysis.predictedMethod || '')).length,
    dec: cardAnalyses.filter(x => x.analysis && /Decis/i.test(x.analysis.predictedMethod || '')).length,
    ticket: cardAnalyses.filter(x => x.hasTicket).length
  };
  document.querySelectorAll('.qf-btn').forEach(btn => {
    const mode = btn.dataset.qf;
    const cntEl = btn.querySelector('.qf-count');
    if (cntEl && qCounts[mode] !== undefined) cntEl.textContent = qCounts[mode];
  });

  const filtered = cardAnalyses.filter(({ c, analysis, hasTicket }) => {
    if (_cardFilter.search) {
      const hay = `${c.fV || ''} ${c.fA || ''} ${c.weightClass || ''}`.toLowerCase();
      if (!hay.includes(_cardFilter.search)) return false;
    }
    if (_cardFilter.quick === 'precision') {
      return Boolean(analysis && analysis.isHighPrecisionPick);
    }
    if (_cardFilter.quick === 'ev') {
      return Boolean(analysis && (analysis.evA > 0.03 || analysis.evB > 0.03));
    }
    if (_cardFilter.quick === 'zebra') {
      return Boolean(analysis && (analysis.zebraAlert || c.oV >= 2.5 || c.oA >= 2.5));
    }
    if (_cardFilter.quick === 'ko') {
      return Boolean(analysis && /KO|TKO/i.test(analysis.predictedMethod || ''));
    }
    if (_cardFilter.quick === 'sub') {
      return Boolean(analysis && /Sub/i.test(analysis.predictedMethod || ''));
    }
    if (_cardFilter.quick === 'dec') {
      return Boolean(analysis && /Decis/i.test(analysis.predictedMethod || ''));
    }
    if (_cardFilter.quick === 'ticket') {
      return hasTicket;
    }
    return true;
  });

  // SEÇÃO PRINCIPAL: FIGHT CARDS com análise física
  if (filtered.length) {
    const cards = filtered.map(item => buildFightCard(item.c, ev, item.idx, item.analysis, item.dbA, item.dbB));
    cardEl.innerHTML = `<div class="fight-cards-grid">${cards.join('')}</div>`;
  } else if (totalFights > 0) {
    cardEl.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div>Nenhuma luta corresponde ao filtro atual.</div>';
  } else {
    cardEl.innerHTML = '<div class="empty"><div class="empty-icon">🥊</div>Nenhuma luta encontrada para este evento.</div>';
  }

  renderMyTicketBar();

  // PunterMind análise tabela
  const pa = ev.punterAnalise || [];
  if (!pa.length) {
    document.getElementById('ev-table-container').innerHTML = '<div class="empty"><div class="empty-icon">📊</div>Nenhuma análise PunterMind encontrada para este evento.</div>';
  } else {
    const rows = pa.map(pm => {
      const evRaw = String(pm.ev || '').trim();
      const isConsenso = evRaw.toUpperCase().includes('CONSENSO') || !evRaw || evRaw === '0.00';
      const evNum = isConsenso ? 0 : parseFloat(evRaw.replace(',', '.').replace('+', '')) || 0;
      const evTag = isConsenso
        ? `<span class="badge badge-lock">🔒 BASE</span>`
        : evNum > 0
          ? `<span class="badge badge-ev-p">▲ ${evRaw}</span>`
          : `<span class="badge badge-ev-n">▼ ${evRaw}</span>`;

      let statusHtml = '<span style="color:var(--text3);font-size:12px">⏳ Futuro</span>';
      if (!ev.isFuturo && pm.pick) {
        const luta = findLuta(ev, pm.pick);
        if (luta && luta.resultado && !NULO.some(x => luta.resultado.toUpperCase().includes(x))) {
          const pickL = pm.pick.toLowerCase().split(' ').pop();
          const hit = luta.resultado.toLowerCase().includes(pickL);
          statusHtml = hit
            ? '<span class="badge badge-win">✅ Green</span>'
            : '<span class="badge badge-ev-n">❌ Red</span>';
        }
      }

      return `<tr>
        <td style="font-weight:600">${escHtml(pm.luta)}</td>
        <td style="font-size:12px;color:var(--text2);max-width:200px">${escHtml(pm.fisico || '—')}</td>
        <td style="font-weight:700;color:var(--cyan)">${escHtml(pm.probReal || pm.probImp || '—')}</td>
        <td>${evTag}</td>
        <td style="font-weight:700;color:var(--gold)">${pm.pick ? '🥊 ' + escHtml(pm.pick) : '—'}</td>
        <td style="font-size:12px;color:var(--text2)">${escHtml(pm.met || '—')}</td>
        <td>${statusHtml}</td>
        <td style="font-size:12px;color:var(--text2);max-width:240px;line-height:1.4">${escHtml(pm.nota || '—')}</td>
      </tr>`;
    }).join('');
    document.getElementById('ev-table-container').innerHTML = `
      <div class="ev-table-wrap">
        <table class="ev-table">
          <thead><tr><th>Luta</th><th>Vantagem Física & Elo</th><th>Prob. Real</th><th>EV</th><th>Pick</th><th>Mét.</th><th>Status</th><th>Nota</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // Apostas sugeridas
  const ap = ev.apostas;
  if (ap && (ap.simples?.selecao || ap.dupla?.selecao || ap.tripla?.selecao)) {
    const apostaCards = [ap.simples, ap.dupla, ap.tripla].filter(a => a && a.selecao).map(a => `
      <div class="aposta-card">
        <div class="ap-tipo">${escHtml(a.tipo || '—')}</div>
        <div class="ap-sel">${escHtml(a.selecao)}</div>
        <div class="ap-odd">${escHtml(a.odd || '—')}</div>
        <div class="ap-nota">${escHtml(a.nota || '')}</div>
      </div>`).join('');
    document.getElementById('ev-apostas-container').innerHTML = `<div class="label-small">🎯 Apostas Sugeridas</div><div class="apostas-grid">${apostaCards}</div>`;
  } else {
    document.getElementById('ev-apostas-container').innerHTML = '';
  }

  if (_currentTab === 'futuros' || _currentTab === 'passados') {
    updateStakesCalculator();
  }
}

// NOVO BUILD FIGHT CARD (Sem skeletons infinitos + Tale highlights + Palpite interativo)
function buildFightCard(c, ev, idx, preAnalysis = null, preDbA = null, preDbB = null) {
  const { fV, oV, fA, oA } = c;
  if (!fV && !fA) return '';

  const editIconV = fV ? `<button type="button" class="fc-edit-btn" data-fighter="${escHtml(fV)}" title="Editar dados físicos de ${escHtml(fV)}">✏️</button>` : '';
  const editIconA = fA ? `<button type="button" class="fc-edit-btn" data-fighter="${escHtml(fA)}" title="Editar dados físicos de ${escHtml(fA)}">✏️</button>` : '';

  let dbA = preDbA || (typeof getFighterData === 'function' ? getFighterData(fV) : null);
  let dbB = preDbB || (typeof getFighterData === 'function' ? getFighterData(fA) : null);

  // Mesclar com ESPN sem nunca sobrescrever dados válidos do DB local com placeholders vazios
  const mergeEspnSafely = (localDb, espnFighter) => {
    if (!espnFighter) return localDb;
    let w = null, l = null, d = 0;
    if (espnFighter.record) {
      const parts = String(espnFighter.record).split('-');
      if (parts.length >= 2) {
        w = parseInt(parts[0], 10);
        l = parseInt(parts[1], 10);
        d = parseInt(parts[2], 10) || 0;
      }
    }
    const base = localDb ? { ...localDb } : {};
    return {
      ...base,
      wins: Number.isFinite(espnFighter.wins) && espnFighter.wins > 0 ? espnFighter.wins : (Number.isFinite(w) && w > 0 ? w : base.wins),
      losses: Number.isFinite(espnFighter.losses) ? espnFighter.losses : (Number.isFinite(l) ? l : base.losses),
      draws: Number.isFinite(espnFighter.draws) ? espnFighter.draws : (base.draws || d || 0),
      height_cm: (espnFighter.height_cm && Number(espnFighter.height_cm) > 0) ? Number(espnFighter.height_cm) : base.height_cm,
      reach_cm: (espnFighter.reach_cm && Number(espnFighter.reach_cm) > 0) ? Number(espnFighter.reach_cm) : base.reach_cm,
      stance: espnFighter.stance || base.stance || '',
      espn_photo: espnFighter.photo || base.espn_photo || null,
      style: base.style || espnFighter.style || ''
    };
  };

  if (c.f1Obj) dbA = mergeEspnSafely(dbA, c.f1Obj);
  if (c.f2Obj) dbB = mergeEspnSafely(dbB, c.f2Obj);

  const defaultPhoto = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIj48Y2lyY2xlIGN4PSIxMDAiIGN5PSI3MCIgcj0iNDUiIGZpbGw9IiMyZDJkM2EiLz48cGF0aCBkPSJNMTAwIDEyNWMtNDAgMC03NSAzMC04NSA3NWgxNzBjLTEwLTQ1LTQ1LTc1LTg1LTc1eiIgZmlsbD0iIzJkMmQzYSIvPjwvc3ZnPg==';
  const photoV = c.espnPhotoV || dbA?.espn_photo;
  const photoA = c.espnPhotoA || dbB?.espn_photo;

  const renderPhoto = (url, name) => {
    const finalUrl = (url && url !== 'null' && url !== 'undefined') ? url : defaultPhoto;
    return `<div class="tale-photo-wrap"><img src="${finalUrl}" class="tale-photo" loading="lazy" decoding="async" onerror="if(this.src !== '${defaultPhoto}'){ this.onerror=null; this.src='${defaultPhoto}'; }" alt="${escHtml(name || 'Lutador')}" /></div>`;
  };

  // Formatadores seguros (nunca geram NaNm)
  const hasRec = db => db && Number.isFinite(Number(db.wins)) && (Number(db.wins) > 0 || Number(db.losses) > 0);
  const fRecord = db => hasRec(db) ? `${db.wins}-${db.losses}${db.draws > 0 ? '-' + db.draws : ''}` : '—';
  const fHeight = db => {
    const h = parseFloat(db?.height_cm);
    return Number.isFinite(h) && h > 50 ? `${(h / 100).toFixed(2)}m` : '—';
  };
  const fReach = db => {
    const r = parseFloat(db?.reach_cm);
    return Number.isFinite(r) && r > 50 ? `${Math.round(r)}cm` : '—';
  };
  const fStance = db => (db && db.stance) ? db.stance : '—';

  const rV = fRecord(dbA), rA = fRecord(dbB);
  const hV = fHeight(dbA), hA = fHeight(dbB);
  const eV = fReach(dbA), eA = fReach(dbB);
  const sV = fStance(dbA), sA = fStance(dbB);

  const hNumV = parseFloat(dbA?.height_cm) || 0, hNumA = parseFloat(dbB?.height_cm) || 0;
  const rNumV = parseFloat(dbA?.reach_cm) || 0,  rNumA = parseFloat(dbB?.reach_cm) || 0;
  const hAdvV = hNumV > 0 && hNumA > 0 && hNumV > hNumA;
  const hAdvA = hNumV > 0 && hNumA > 0 && hNumA > hNumV;
  const eAdvV = rNumV > 0 && rNumA > 0 && rNumV > rNumA;
  const eAdvA = rNumV > 0 && rNumA > 0 && rNumA > rNumV;

  // Análise multi-fator com Rating Elo UFC & Momentum
  const eloCtx = getFighterEloCtx(fV, fA, c);
  const analysis = preAnalysis || (typeof analyzeFight === 'function' ? analyzeFight(fV, fA, oV, oA, dbA, dbB, _zebraStats, eloCtx) : null);

  // Odds formatting (reais ou estimadas)
  const renderOdds = (oddNum, estOdd, espnOddStr) => {
    if (oddNum && oddNum > 1) {
      const isFav = oddNum < 1.65;
      return `<div class="tale-odds ${isFav ? 'fav' : ''}">${Number(oddNum).toFixed(2)}</div>`;
    }
    if (espnOddStr && espnOddStr !== 'Sem odds') {
      return `<div class="tale-odds est">${escHtml(espnOddStr)}</div>`;
    }
    if (estOdd) {
      return `<div class="tale-odds est" title="Odd justa estimada pelo modelo">Est. ${Number(estOdd).toFixed(2)}</div>`;
    }
    return '';
  };
  const oddsVHtml = renderOdds(oV, analysis?.oddsEstA, c.espnOdds);
  const oddsAHtml = renderOdds(oA, analysis?.oddsEstB, c.espnOdds);

  // Resultado
  const luta = findLuta(ev, fV || fA);
  const resultado = luta?.resultado || null;
  const winLastV = (fV || '').toLowerCase().split(' ').pop();
  const winLastA = (fA || '').toLowerCase().split(' ').pop();
  const isWinV = Boolean(resultado && winLastV && resultado.toLowerCase().includes(winLastV));
  const isWinA = Boolean(resultado && winLastA && resultado.toLowerCase().includes(winLastA));

  // Barra de probabilidade comparativa
  const pV = analysis?.probAdjA ? Math.round(analysis.probAdjA * 100) : 50;
  const pA = 100 - pV;

  // Badges (EV+, Zebra, Pick, Resultado)
  let badges = '';
  if (analysis) {
    if (analysis.evA > 0.03) badges += `<span class="badge badge-ev-p">EV+ ${escHtml(fV?.split(' ').pop() || '')} (+${(analysis.evA * 100).toFixed(1)}%)</span>`;
    if (analysis.evB > 0.03) badges += `<span class="badge badge-ev-p">EV+ ${escHtml(fA?.split(' ').pop() || '')} (+${(analysis.evB * 100).toFixed(1)}%)</span>`;
    if (analysis.zebraAlert) badges += `<span class="badge badge-zebra">🦓 ALERTA ZEBRA</span>`;
    if (analysis.predictedMethod) badges += `<span class="badge badge-method">🥊 ${escHtml(analysis.predictedMethod)}</span>`;
  }
  if (resultado) {
    badges += `<span class="badge badge-win">✅ Venceu: ${escHtml(resultado)}${luta?.metodo ? ' (' + escHtml(luta.metodo) + ')' : ''}</span>`;
  }

  // Banner do Pick recomendado do modelo (Alta Precisão vs Luta Equilibrada)
  const pickBanner = analysis?.pickRecommended ? `
    <div class="fc-pick-banner ${analysis.isHighPrecisionPick ? 'has-ev' : 'is-balanced'}">
      <span class="fc-pick-lbl">${analysis.isHighPrecisionPick ? '🎯 Pick Alta Precisão:' : '⚖️ Tendência Leve (50/50):'}</span>
      <strong class="fc-pick-name">${escHtml(analysis.pickRecommended)}</strong>
      <span class="fc-pick-conf">${analysis.pickConf}% prob.${analysis.pickIsEstimate ? ' (Est.)' : ''} · Elo ${analysis.eloA}×${analysis.eloB}</span>
    </div>
  ` : '';

  // Ticket interativo do usuário ("Meu Palpite")
  const tKey = getTicketKey(ev.nome, fV, fA);
  const myPick = _myTickets[tKey]?.pick || '';
  const selBtnV = `<button type="button" class="fc-pick-btn ${myPick === fV ? 'picked' : ''}" data-pick-ev="${escHtml(ev.nome)}" data-pick-fv="${escHtml(fV)}" data-pick-fa="${escHtml(fA)}" data-pick-name="${escHtml(fV)}" data-pick-odd="${oV || analysis?.oddsEstA || ''}" data-pick-zebra="${(oV || 0) >= 2.5 ? '1' : '0'}" data-pick-eval="${analysis?.evA || 0}">${myPick === fV ? '✓ Meu Palpite' : 'Palpitar'}</button>`;
  const selBtnA = `<button type="button" class="fc-pick-btn ${myPick === fA ? 'picked' : ''}" data-pick-ev="${escHtml(ev.nome)}" data-pick-fv="${escHtml(fV)}" data-pick-fa="${escHtml(fA)}" data-pick-name="${escHtml(fA)}" data-pick-odd="${oA || analysis?.oddsEstB || ''}" data-pick-zebra="${(oA || 0) >= 2.5 ? '1' : '0'}" data-pick-eval="${analysis?.evB || 0}">${myPick === fA ? '✓ Meu Palpite' : 'Palpitar'}</button>`;

  const weightLabel = c.weightClass || dbA?.weight_class || dbB?.weight_class || 'UFC Bout';
  const segLabel = c.cardSegment || (idx === 0 ? 'Main Event' : idx === 1 ? 'Co-Main' : '');
  const styleVTag = dbA?.style ? `<span class="fc-style-tag">${escHtml(dbA.style)}</span>` : '';
  const styleATag = dbB?.style ? `<span class="fc-style-tag">${escHtml(dbB.style)}</span>` : '';

  // Botão de IA
  const aiBtnId = `ai-btn-${idx}`;
  const recPick = analysis?.pickRecommended ? analysis.pickRecommended.replace(/'/g, "\\'") : '';
  const aiHtml = `
    <div id="${aiBtnId}-container" style="margin-top: 10px; width: 100%;">
      <button type="button" class="ai-btn-card" onclick="analyzeFightWithAI('${(fV||'').replace(/'/g, "\\'")}', '${(fA||'').replace(/'/g, "\\'")}', '${aiBtnId}-container', '${recPick}')">
        ⚡ Raio-X Tático
      </button>
    </div>
  `;

  return `
    <div class="tale-card ${myPick ? 'has-my-pick' : ''}" style="animation-delay:${Math.min(idx, 12) * 0.04}s" data-fighters="${escHtml((fV||'').toLowerCase())}|${escHtml((fA||'').toLowerCase())}" data-card-idx="${idx}">
      <div class="tale-header">
        <span>${escHtml(weightLabel)}</span>
        ${segLabel ? `<span class="tale-seg">${escHtml(segLabel)}</span>` : ''}
      </div>

      <div class="tale-body">
        <div class="tale-fighter left ${isWinV ? 'winner' : ''} ${myPick === fV ? 'user-picked' : ''}">
          ${renderPhoto(photoV, fV)}
          <div class="tale-name">${escHtml(fV || '—')} ${editIconV}</div>
          ${styleVTag}
          ${oddsVHtml}
          ${selBtnV}
        </div>

        <div class="tale-center">
          <div class="tale-row">
            <span class="val left">${rV}</span>
            <span class="lbl">CARTEL</span>
            <span class="val right">${rA}</span>
          </div>
          <div class="tale-row">
            <span class="val left ${hAdvV ? 'adv' : ''}">${hV}</span>
            <span class="lbl">ALTURA</span>
            <span class="val right ${hAdvA ? 'adv' : ''}">${hA}</span>
          </div>
          <div class="tale-row">
            <span class="val left ${eAdvV ? 'adv' : ''}">${eV}</span>
            <span class="lbl">ENVERG.</span>
            <span class="val right ${eAdvA ? 'adv' : ''}">${eA}</span>
          </div>
          <div class="tale-row">
            <span class="val left">${escHtml(sV)}</span>
            <span class="lbl">BASE</span>
            <span class="val right">${escHtml(sA)}</span>
          </div>
        </div>

        <div class="tale-fighter right ${isWinA ? 'winner' : ''} ${myPick === fA ? 'user-picked' : ''}">
          ${renderPhoto(photoA, fA)}
          <div class="tale-name">${escHtml(fA || '—')} ${editIconA}</div>
          ${styleATag}
          ${oddsAHtml}
          ${selBtnA}
        </div>
      </div>

      <div class="prob-split">
        <div class="prob-split-labels">
          <span>${pV}%</span>
          <span class="prob-split-title">PROBABILIDADE MODELO</span>
          <span>${pA}%</span>
        </div>
        <div class="prob-split-track">
          <div class="prob-split-a" style="width:${pV}%"></div>
          <div class="prob-split-b" style="width:${pA}%"></div>
        </div>
      </div>

      ${pickBanner}
      <div class="tale-badges">${badges}</div>
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
    renderMyBetsHistory();
    switchHistSubTab(_currentHistSubTab || 'overview');
  }
  
  // Alternar exibições de conteúdo
  const contentCards = document.getElementById('tab-content-cards');
  const contentHistorico = document.getElementById('tab-content-historico');
  
  if (contentCards) contentCards.style.display = (tabId === 'futuros' || tabId === 'passados') ? 'block' : 'none';
  if (contentHistorico) contentHistorico.style.display = tabId === 'historico' ? 'block' : 'none';
  
  populateEventSelector(tabId);
}

function switchHistSubTab(subTab) {
  _currentHistSubTab = subTab || 'overview';
  document.querySelectorAll('.hist-subtab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.htab === _currentHistSubTab);
  });
  document.querySelectorAll('[data-hist-group]').forEach(sec => {
    const grp = sec.dataset.histGroup;
    sec.style.display = (_currentHistSubTab === 'all' || grp === _currentHistSubTab) ? 'block' : 'none';
  });
  if (_currentHistSubTab === 'mybets') {
    renderMyBetsHistory();
  }
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

  // Separar estritamente usando isFuturo quando definido (com fallback por data)
  const futuros  = _eventos.filter(e => typeof e.isFuturo === 'boolean' ? e.isFuturo : (!evDate(e) || evDate(e) >= hoje));
  const passados = _eventos.filter(e => typeof e.isFuturo === 'boolean' ? !e.isFuturo : (evDate(e) && evDate(e) < hoje));

  // Decidir lista ativa com base na aba (sem misturar passados em futuros!)
  let listaAtiva;
  if (tabId === 'futuros') {
    listaAtiva = futuros;
  } else if (tabId === 'passados') {
    listaAtiva = passados;
  } else {
    listaAtiva = passados.length ? passados : _eventos;
  }

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
    if (!fV || !fA) return;

    const dbA = getFighterData(fV);
    const dbB = getFighterData(fA);
    const eloCtx = getFighterEloCtx(fV, fA, c);
    const analysis = analyzeFight(fV, fA, oV, oA, dbA, dbB, _zebraStats, eloCtx);

    if (analysis && analysis.pickRecommended) {
      const pickName = analysis.pickRecommended;
      const isV = pickName.toLowerCase() === fV.toLowerCase();
      const rawOdd = isV ? oV : oA;
      const estOdd = isV ? analysis.oddsEstA : analysis.oddsEstB;
      const odds = (rawOdd && rawOdd > 1) ? rawOdd : (estOdd || 1.90);
      const isEst = !(rawOdd && rawOdd > 1);
      const prob = isV ? analysis.probAdjA : analysis.probAdjB;
      const evValue = isV ? analysis.evA : analysis.evB;
      const confidence = isV ? analysis.confidenceA : analysis.confidenceB;

      stakesList.push({
        fight: `${fV} vs ${fA}`,
        pick: pickName,
        odds,
        isEst,
        prob,
        ev: evValue || 0,
        confidence
      });
    }
  });

  if (stakesList.length === 0) {
    container.innerHTML = `<div class="empty" style="padding: 24px;"><div class="empty-icon">💸</div>Nenhum palpite calculável para este card.</div>`;
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
        <td style="font-weight:600">${p.isEst ? '<span style="color:var(--text3);font-size:11px">Est.</span> ' : ''}${p.odds.toFixed(2)}</td>
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

function renderFighterProfileSummary(name, data) {
  const sumEl = document.getElementById('fighter-profile-summary');
  if (!sumEl) return;

  const norm = normOddName(name);
  const elo = Math.round((window._fighterElo && window._fighterElo[norm]) || 1500);
  const streak = (window._fighterStreak && window._fighterStreak[norm]) || 0;
  const streakTxt = streak > 0 ? `+${streak}W` : streak < 0 ? `${streak}L` : '0';
  const rec = (data && data.wins != null && data.losses != null)
    ? `${data.wins}-${data.losses}${data.draws ? '-' + data.draws : ''}`
    : '—';
  const styleTxt = (data && data.style) || 'MMA';
  const koSubTxt = (data && (data.ko_wins || data.sub_wins))
    ? `${data.ko_wins || 0} KO · ${data.sub_wins || 0} SUB`
    : '—';

  const fights = [];
  const lastTok = norm.split(' ').pop();
  for (const ev of _eventos) {
    for (const c of (ev.cardLutas || [])) {
      const nV = normOddName(c.fV);
      const nA = normOddName(c.fA);
      const isV = nV === norm || (lastTok.length > 3 && nV.endsWith(' ' + lastTok));
      const isA = nA === norm || (lastTok.length > 3 && nA.endsWith(' ' + lastTok));
      if (!isV && !isA) continue;
      const opp = isV ? c.fA : c.fV;
      const myOdd = isV ? c.oV : c.oA;
      const lutaRes = findLuta(ev, name);
      let statusBadge = '<span style="color:var(--gold)">⏳ Agendada</span>';
      if (!ev.isFuturo && lutaRes && lutaRes.resultado) {
        const resNorm = normOddName(lutaRes.resultado);
        const won = resNorm === norm || (lastTok.length > 3 && resNorm.includes(lastTok));
        statusBadge = won
          ? '<span style="color:var(--green);font-weight:700">✅ Vitória</span>'
          : '<span style="color:var(--red);font-weight:700">❌ Derrota</span>';
      }
      fights.push({
        evento: ev.nome,
        data: ev.dataEvento || '',
        opp,
        odd: myOdd ? `@${Number(myOdd).toFixed(2)}` : '',
        statusBadge
      });
    }
  }

  const historyHtml = fights.length
    ? fights.slice(0, 8).map(f => `
        <div class="fp-fight-row">
          <span><strong>vs ${escHtml(f.opp)}</strong> <small style="color:var(--text3)">(${escHtml(f.evento)}${f.data ? ' · ' + escHtml(f.data) : ''})</small></span>
          <span>${f.odd ? `<small style="color:var(--cyan);margin-right:6px">${f.odd}</small>` : ''}${f.statusBadge}</span>
        </div>
      `).join('')
    : '<div style="font-size:12px;color:var(--text3)">Sem lutas registradas nos 121 cards da base.</div>';

  sumEl.innerHTML = `
    <div class="fp-kpis">
      <div class="fp-kpi"><span>Rating Elo</span><strong style="color:var(--cyan)">${elo}</strong></div>
      <div class="fp-kpi"><span>Sequência</span><strong>${streakTxt}</strong></div>
      <div class="fp-kpi"><span>Cartel</span><strong>${escHtml(rec)}</strong></div>
      <div class="fp-kpi"><span>Estilo</span><strong>${escHtml(styleTxt)}</strong></div>
      <div class="fp-kpi"><span>Via Rápida</span><strong>${escHtml(koSubTxt)}</strong></div>
    </div>
    <div class="fp-history-title">📜 Histórico no UFC (${fights.length} ${fights.length === 1 ? 'luta encontrada' : 'lutas encontradas'})</div>
    <div class="fp-history-list">${historyHtml}</div>
  `;
}

function searchGlobalFighters(query) {
  const drop = document.getElementById('global-fighter-dropdown');
  if (!drop) return [];
  const q = normOddName(query);
  if (q.length < 2) {
    drop.style.display = 'none';
    drop.innerHTML = '';
    return [];
  }

  const results = [];
  const seen = new Set();
  if (typeof FIGHTERS_DB === 'object' && FIGHTERS_DB) {
    for (const [k, info] of Object.entries(FIGHTERS_DB)) {
      if (k.includes(q)) {
        const displayName = (info && info.name) || k.replace(/\b\w/g, ch => ch.toUpperCase());
        const elo = Math.round((window._fighterElo && window._fighterElo[k]) || 1500);
        const rec = (info && info.wins != null && info.losses != null) ? `${info.wins}-${info.losses}` : '';
        results.push({ name: displayName, style: info?.style || 'MMA', rec, elo });
        seen.add(k);
        if (results.length >= 8) break;
      }
    }
  }

  if (results.length < 8) {
    for (const ev of _eventos) {
      for (const c of (ev.cardLutas || [])) {
        for (const fName of [c.fV, c.fA]) {
          const nk = normOddName(fName);
          if (!nk || seen.has(nk) || !nk.includes(q)) continue;
          const db = typeof getFighterData === 'function' ? getFighterData(fName) : null;
          const elo = Math.round((window._fighterElo && window._fighterElo[nk]) || 1500);
          results.push({ name: fName, style: db?.style || 'MMA', rec: db?.wins != null ? `${db.wins}-${db.losses}` : '', elo });
          seen.add(nk);
          if (results.length >= 8) break;
        }
        if (results.length >= 8) break;
      }
      if (results.length >= 8) break;
    }
  }

  if (!results.length) {
    drop.innerHTML = '<div class="gf-item" style="color:var(--text3);cursor:default">Nenhum lutador encontrado.</div>';
    drop.style.display = 'block';
    return [];
  }

  drop.innerHTML = results.map(r => `
    <button type="button" class="gf-item" data-gf-name="${escHtml(r.name)}">
      <strong>🥊 ${escHtml(r.name)}</strong>
      <span class="gf-item-meta">${escHtml(r.style)}${r.rec ? ' · ' + escHtml(r.rec) : ''} · Elo ${r.elo}</span>
    </button>
  `).join('');
  drop.style.display = 'block';
  return results;
}

function openFighterModal(name) {
  _currentEditingFighter = name;
  const drop = document.getElementById('global-fighter-dropdown');
  if (drop) drop.style.display = 'none';
  const nameInput = document.getElementById('fighter-name');
  if (nameInput) nameInput.value = name;

  const data = getFighterData(name);
  renderFighterProfileSummary(name, data);
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

  const hRaw = document.getElementById('fighter-height').value;
  const rRaw = document.getElementById('fighter-reach').value;
  const hVal = hRaw ? parseFloat(hRaw) : null;
  const rVal = rRaw ? parseFloat(rRaw) : null;
  const stanceVal = document.getElementById('fighter-stance').value;
  const styleVal = document.getElementById('fighter-style').value;

  if ((hVal !== null && (isNaN(hVal) || hVal < 100)) || (rVal !== null && (isNaN(rVal) || rVal < 100))) {
    alert('Se preencher altura ou envergadura, insira valores válidos (mínimo de 100 cm).');
    return;
  }

  const prev = getFighterData(_currentEditingFighter) || {};
  saveCustomFighter(_currentEditingFighter, {
    ...prev,
    ...(hVal ? { height_cm: hVal } : {}),
    ...(rVal ? { reach_cm: rVal } : {}),
    stance: stanceVal,
    style: styleVal
  });

  if (styleVal) _lutadores[_currentEditingFighter.toLowerCase()] = styleVal;
  closeFighterModal();
  ensureAllEventsAnalyzed();
  renderEvento();
  renderAll();
}

// ── INIT ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const fighterModal = document.getElementById('fighter-modal');
  if (fighterModal) {
    fighterModal.addEventListener('click', e => {
      if (e.target === fighterModal) closeFighterModal();
    });
  }

  const searchEl = document.getElementById('card-search-input');
  if (searchEl) {
    searchEl.addEventListener('input', e => setCardSearch(e.target.value));
  }

  const globalSearchEl = document.getElementById('global-fighter-input');
  if (globalSearchEl) {
    globalSearchEl.addEventListener('input', e => searchGlobalFighters(e.target.value));
  }

  loadData();
});

// Event listeners centralizados (modal de lutador + palpites + bilhete)
document.addEventListener('click', e => {
  const gfBtn = e.target.closest('.gf-item[data-gf-name]');
  if (gfBtn) {
    openFighterModal(gfBtn.dataset.gfName);
    return;
  }

  const drop = document.getElementById('global-fighter-dropdown');
  if (drop && !e.target.closest('.global-fighter-search-wrap')) {
    drop.style.display = 'none';
  }

  const editBtn = e.target.closest('.fc-edit-btn');
  if (editBtn) {
    openFighterModal(editBtn.dataset.fighter);
    return;
  }

  const pickBtn = e.target.closest('.fc-pick-btn');
  if (pickBtn) {
    toggleMyPick(
      pickBtn.dataset.pickEv,
      pickBtn.dataset.pickFv,
      pickBtn.dataset.pickFa,
      pickBtn.dataset.pickName,
      pickBtn.dataset.pickOdd,
      pickBtn.dataset.pickZebra === '1',
      pickBtn.dataset.pickEval
    );
    return;
  }

  const rmTicketBtn = e.target.closest('.ticket-chip-rm');
  if (rmTicketBtn) {
    removeMyPick(rmTicketBtn.dataset.rmTicket);
    return;
  }

  const qfBtn = e.target.closest('.qf-btn');
  if (qfBtn) {
    setQuickFilter(qfBtn.dataset.qf);
  }
});
