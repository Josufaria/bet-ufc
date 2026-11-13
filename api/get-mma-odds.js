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

function parseJsonOrArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

async function fetchJsonWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromTheOddsApi(apiKey) {
  if (!apiKey) return [];
  const url = `https://api.the-odds-api.com/v4/sports/mma_mixed_martial_arts/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=us,eu&markets=h2h&oddsFormat=decimal`;
  const data = await fetchJsonWithTimeout(url, 2600);
  if (!Array.isArray(data)) return [];

  const quotes = [];
  for (const ev of data) {
    const fA = ev.home_team || '';
    const fB = ev.away_team || '';
    if (!fA || !fB) continue;
    const nA = normalizeName(fA);
    const nB = normalizeName(fB);

    for (const bk of (ev.bookmakers || [])) {
      const h2h = (bk.markets || []).find(m => m.key === 'h2h');
      if (!h2h) continue;
      let oA = null;
      let oB = null;
      for (const out of (h2h.outcomes || [])) {
        const nk = normalizeName(out.name);
        const price = Number(out.price);
        if (!Number.isFinite(price) || price <= 1.01) continue;
        if (nk === nA) oA = +price.toFixed(2);
        else if (nk === nB) oB = +price.toFixed(2);
      }
      if (oA || oB) {
        quotes.push({
          eventName: ev.sport_title || 'MMA',
          fighterA: fA,
          fighterB: fB,
          provider: bk.title || bk.key || 'Bookmaker',
          oddA: oA,
          oddB: oB,
          openOddA: null,
          openOddB: null,
          commenceTime: ev.commence_time || null
        });
      }
    }
  }
  return quotes;
}

async function fetchFromEspnLive() {
  const now = new Date();
  const ymd = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const start = new Date(now.getTime() - 3 * 86400000);
  const end = new Date(now.getTime() + 90 * 86400000);
  const url = `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${ymd(start)}-${ymd(end)}`;
  const data = await fetchJsonWithTimeout(url, 2400);
  if (!data || !Array.isArray(data.events)) return [];

  const quotes = [];
  const coreTasks = [];

  for (const ev of data.events) {
    const isCompletedEv = Boolean(ev.status?.type?.completed);
    for (const comp of (ev.competitions || [])) {
      const comps = comp.competitors || [];
      if (comps.length < 2) continue;
      const fA = comps[0].athlete?.displayName || comps[0].athlete?.fullName || '';
      const fB = comps[1].athlete?.displayName || comps[1].athlete?.fullName || '';
      if (!fA || !fB) continue;

      const oddObj = comp.odds?.[0] || null;
      if (oddObj) {
        const oddA = oddObj.homeTeamOdds?.moneyLine != null ? americanToDecimal(oddObj.homeTeamOdds.moneyLine) : null;
        const oddB = oddObj.awayTeamOdds?.moneyLine != null ? americanToDecimal(oddObj.awayTeamOdds.moneyLine) : null;
        const openOddA = oddObj.homeTeamOdds?.open?.moneyLine != null ? americanToDecimal(oddObj.homeTeamOdds.open.moneyLine) : null;
        const openOddB = oddObj.awayTeamOdds?.open?.moneyLine != null ? americanToDecimal(oddObj.awayTeamOdds.open.moneyLine) : null;
        if (oddA || oddB) {
          quotes.push({
            eventName: ev.name || '',
            fighterA: fA,
            fighterB: fB,
            provider: oddObj.provider?.name || 'ESPN Bet',
            oddA,
            oddB,
            openOddA,
            openOddB,
            commenceTime: comp.date || ev.date || null
          });
        }
      }

      if (!isCompletedEv && ev.id && comp.id && coreTasks.length < 20) {
        const coreUrl = `https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events/${ev.id}/competitions/${comp.id}/odds`;
        coreTasks.push(
          fetchJsonWithTimeout(coreUrl, 1600).then(coreData => {
            if (!coreData || !Array.isArray(coreData.items)) return;
            for (const item of coreData.items) {
              const oddA = item.homeTeamOdds?.moneyLine != null ? americanToDecimal(item.homeTeamOdds.moneyLine) : null;
              const oddB = item.awayTeamOdds?.moneyLine != null ? americanToDecimal(item.awayTeamOdds.moneyLine) : null;
              const rawOpenA = item.homeTeamOdds?.open?.moneyLine ?? item.homeTeamOdds?.open?.odds?.american;
              const rawOpenB = item.awayTeamOdds?.open?.moneyLine ?? item.awayTeamOdds?.open?.odds?.american;
              const openOddA = rawOpenA != null ? americanToDecimal(rawOpenA) : null;
              const openOddB = rawOpenB != null ? americanToDecimal(rawOpenB) : null;
              if (oddA || oddB) {
                quotes.push({
                  eventName: ev.name || '',
                  fighterA: fA,
                  fighterB: fB,
                  provider: item.provider?.name || 'ESPN Provider',
                  oddA,
                  oddB,
                  openOddA,
                  openOddB,
                  commenceTime: comp.date || ev.date || null
                });
              }
            }
          })
        );
      }
    }
  }

  if (coreTasks.length) {
    await Promise.allSettled(coreTasks);
  }
  return quotes;
}

async function fetchFromPolymarketUfc() {
  const url = 'https://gamma-api.polymarket.com/events?tag_slug=ufc&closed=false&limit=40';
  const data = await fetchJsonWithTimeout(url, 2200);
  if (!Array.isArray(data)) return [];

  const quotes = [];
  const nonFighterWords = /^(yes|no|over|under|draw|tie|round\s+\d+|decision|ko|tko|submission)$/i;

  for (const ev of data) {
    for (const mkt of (ev.markets || [])) {
      const outcomes = parseJsonOrArray(mkt.outcomes);
      const prices = parseJsonOrArray(mkt.outcomePrices);
      if (outcomes.length !== 2 || prices.length !== 2) continue;

      const fA = String(outcomes[0] || '').trim();
      const fB = String(outcomes[1] || '').trim();
      if (!fA || !fB || nonFighterWords.test(fA) || nonFighterWords.test(fB)) continue;

      const pA = Number(prices[0]);
      const pB = Number(prices[1]);
      if (!(pA > 0.04 && pA < 0.96 && pB > 0.04 && pB < 0.96)) continue;

      quotes.push({
        eventName: ev.title || 'Polymarket UFC',
        fighterA: fA,
        fighterB: fB,
        provider: 'Polymarket',
        oddA: +(1 / pA).toFixed(2),
        oddB: +(1 / pB).toFixed(2),
        openOddA: null,
        openOddB: null,
        commenceTime: ev.endDate || null
      });
    }
  }
  return quotes;
}

function makePairKey(fA, fB) {
  const a = normalizeName(fA);
  const b = normalizeName(fB);
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function aggregateMatchups(allQuotes) {
  const grouped = new Map();

  for (const q of allQuotes) {
    if (!q.fighterA || !q.fighterB || (!q.oddA && !q.oddB)) continue;
    const key = makePairKey(q.fighterA, q.fighterB);
    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = {
        eventName: q.eventName || '',
        fighterA: q.fighterA,
        fighterB: q.fighterB,
        normA: normalizeName(q.fighterA),
        normB: normalizeName(q.fighterB),
        commenceTime: q.commenceTime || null,
        quotesA: [],
        quotesB: [],
        openA: [],
        openB: [],
        providers: new Set()
      };
      grouped.set(key, bucket);
    }

    const qNormA = normalizeName(q.fighterA);
    const sameOrder = qNormA === bucket.normA;
    const oA = sameOrder ? q.oddA : q.oddB;
    const oB = sameOrder ? q.oddB : q.oddA;
    const opA = sameOrder ? q.openOddA : q.openOddB;
    const opB = sameOrder ? q.openOddB : q.openOddA;
    const prov = String(q.provider || 'Market').trim();

    bucket.providers.add(prov);
    if (oA && oA > 1.01) bucket.quotesA.push({ odd: oA, provider: prov });
    if (oB && oB > 1.01) bucket.quotesB.push({ odd: oB, provider: prov });
    if (opA && opA > 1.01) bucket.openA.push(opA);
    if (opB && opB > 1.01) bucket.openB.push(opB);
  }

  const matchups = [];
  for (const b of grouped.values()) {
    const avgA = b.quotesA.length
      ? +(b.quotesA.reduce((s, x) => s + x.odd, 0) / b.quotesA.length).toFixed(2)
      : null;
    const avgB = b.quotesB.length
      ? +(b.quotesB.reduce((s, x) => s + x.odd, 0) / b.quotesB.length).toFixed(2)
      : null;
    const bestA = b.quotesA.length
      ? b.quotesA.reduce((best, x) => (x.odd > best.odd ? x : best), b.quotesA[0])
      : null;
    const bestB = b.quotesB.length
      ? b.quotesB.reduce((best, x) => (x.odd > best.odd ? x : best), b.quotesB[0])
      : null;

    matchups.push({
      eventName: b.eventName,
      fighterA: b.fighterA,
      fighterB: b.fighterB,
      knownA: Boolean(FIGHTERS_DB[b.normA]),
      knownB: Boolean(FIGHTERS_DB[b.normB]),
      oddA: avgA,
      oddB: avgB,
      bestOddA: bestA ? bestA.odd : avgA,
      bestBookA: bestA ? bestA.provider : null,
      bestOddB: bestB ? bestB.odd : avgB,
      bestBookB: bestB ? bestB.provider : null,
      openOddA: b.openA.length ? b.openA[0] : null,
      openOddB: b.openB.length ? b.openB[0] : null,
      commenceTime: b.commenceTime,
      bookmakers: b.providers.size,
      providers: Array.from(b.providers)
    });
  }

  return matchups;
}

async function handler(req, res) {
  try {
    const headerKey = req.headers && (req.headers['x-odds-api-key'] || req.headers['X-Odds-Api-Key']);
    const queryKey = req.query && req.query.apiKey;
    const apiKey = String(process.env.ODDS_API_KEY || headerKey || queryKey || '').trim();

    const [espnRes, polyRes, oddsApiRes] = await Promise.allSettled([
      fetchFromEspnLive(),
      fetchFromPolymarketUfc(),
      fetchFromTheOddsApi(apiKey)
    ]);

    const espnQuotes = espnRes.status === 'fulfilled' ? espnRes.value : [];
    const polyQuotes = polyRes.status === 'fulfilled' ? polyRes.value : [];
    const oddsApiQuotes = oddsApiRes.status === 'fulfilled' ? oddsApiRes.value : [];

    const allQuotes = [...oddsApiQuotes, ...espnQuotes, ...polyQuotes];
    const matchups = aggregateMatchups(allQuotes);

    const activeSources = [];
    if (oddsApiQuotes.length) activeSources.push('the-odds-api');
    if (espnQuotes.length) activeSources.push('espn-live');
    if (polyQuotes.length) activeSources.push('polymarket');

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.status(200).json({
      success: true,
      source: activeSources.length ? activeSources.join('+') : 'espn-live',
      hasOddsApiKey: Boolean(apiKey),
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
  }
}

handler.aggregateMatchups = aggregateMatchups;
module.exports = handler;
