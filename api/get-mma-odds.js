const FIGHTERS_DB = require('./fighters-db-node');

function normalizeName(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function americanToDecimal(ml) {
  const n = Number(ml);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return +(1 + n / 100).toFixed(2);
  return +(1 + 100 / Math.abs(n)).toFixed(2);
}

async function fetchFromTheOddsApi(apiKey, signal) {
  const url = `https://api.the-odds-api.com/v4/sports/mma_mixed_martial_arts/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=us,eu&markets=h2h&oddsFormat=decimal`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`Odds API HTTP ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data)) return [];

  return data.map(ev => {
    const sums = {};
    const counts = {};
    const best = {};
    for (const bk of (ev.bookmakers || [])) {
      const h2h = (bk.markets || []).find(m => m.key === 'h2h');
      if (!h2h) continue;
      for (const out of (h2h.outcomes || [])) {
        const key = normalizeName(out.name);
        const price = Number(out.price);
        if (!key || !Number.isFinite(price) || price <= 1.01) continue;
        sums[key] = (sums[key] || 0) + price;
        counts[key] = (counts[key] || 0) + 1;
        if (!best[key] || price > best[key]) best[key] = price;
      }
    }

    const fA = ev.home_team || '';
    const fB = ev.away_team || '';
    const nA = normalizeName(fA);
    const nB = normalizeName(fB);
    const oddA = counts[nA] ? +(sums[nA] / counts[nA]).toFixed(2) : null;
    const oddB = counts[nB] ? +(sums[nB] / counts[nB]).toFixed(2) : null;

    return {
      fighterA: fA,
      fighterB: fB,
      oddA,
      oddB,
      bestOddA: best[nA] ? +best[nA].toFixed(2) : oddA,
      bestOddB: best[nB] ? +best[nB].toFixed(2) : oddB,
      openOddA: null,
      openOddB: null,
      commenceTime: ev.commence_time || null,
      bookmakers: (ev.bookmakers || []).length
    };
  }).filter(m => m.fighterA && m.fighterB && (m.oddA || m.oddB));
}

async function fetchFromEspnLive(signal) {
  const now = new Date();
  const ymd = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const start = new Date(now.getTime() - 3 * 86400000);
  const end = new Date(now.getTime() + 90 * 86400000);
  const url = `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${ymd(start)}-${ymd(end)}`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`ESPN Odds HTTP ${resp.status}`);
  const data = await resp.json();

  const matchups = [];
  for (const ev of (data.events || [])) {
    for (const comp of (ev.competitions || [])) {
      const comps = comp.competitors || [];
      if (comps.length < 2) continue;
      const fA = comps[0].athlete?.displayName || comps[0].athlete?.fullName || '';
      const fB = comps[1].athlete?.displayName || comps[1].athlete?.fullName || '';
      const oddObj = comp.odds?.[0] || null;
      const oddA = oddObj?.homeTeamOdds?.moneyLine != null ? americanToDecimal(oddObj.homeTeamOdds.moneyLine) : null;
      const oddB = oddObj?.awayTeamOdds?.moneyLine != null ? americanToDecimal(oddObj.awayTeamOdds.moneyLine) : null;
      const openOddA = oddObj?.homeTeamOdds?.open?.moneyLine != null ? americanToDecimal(oddObj.homeTeamOdds.open.moneyLine) : null;
      const openOddB = oddObj?.awayTeamOdds?.open?.moneyLine != null ? americanToDecimal(oddObj.awayTeamOdds.open.moneyLine) : null;

      if (fA && fB && (oddA || oddB)) {
        matchups.push({
          eventName: ev.name || '',
          fighterA: fA,
          fighterB: fB,
          knownA: Boolean(FIGHTERS_DB[normalizeName(fA)]),
          knownB: Boolean(FIGHTERS_DB[normalizeName(fB)]),
          oddA,
          oddB,
          bestOddA: oddA,
          bestOddB: oddB,
          openOddA,
          openOddB,
          commenceTime: comp.date || ev.date || null,
          bookmakers: 1
        });
      }
    }
  }
  return matchups;
}

module.exports = async function handler(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);

  try {
    const apiKey = process.env.ODDS_API_KEY || '';
    let source = 'espn-live';
    let matchups = [];

    if (apiKey) {
      try {
        matchups = await fetchFromTheOddsApi(apiKey, controller.signal);
        source = 'the-odds-api';
      } catch (e) {
        matchups = await fetchFromEspnLive(controller.signal);
        source = 'espn-live';
      }
    } else {
      matchups = await fetchFromEspnLive(controller.signal);
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.status(200).json({
      success: true,
      source,
      updatedAt: new Date().toISOString(),
      count: matchups.length,
      matchups
    });
  } catch (err) {
    console.error('get-mma-odds error:', err.message);
    res.status(200).json({
      success: false,
      source: 'fallback-empty',
      error: err.message,
      matchups: []
    });
  } finally {
    clearTimeout(timer);
  }
};
