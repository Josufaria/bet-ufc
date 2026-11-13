const FIGHTERS_DB = require('./fighters-db-node');

function normalizeName(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lookupLocalFighter(name) {
  const norm = normalizeName(name);
  if (!norm) return {};
  if (FIGHTERS_DB[norm]) return FIGHTERS_DB[norm];
  const parts = norm.split(' ');
  if (parts.length >= 2) {
    const rev = `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}`;
    if (FIGHTERS_DB[rev]) return FIGHTERS_DB[rev];
  }
  return {};
}

function americanToDecimal(ml) {
  const n = Number(ml);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return +(1 + n / 100).toFixed(2);
  return +(1 + 100 / Math.abs(n)).toFixed(2);
}

function parseRecordNums(recordStr) {
  const m = String(recordStr || '').match(/(\d+)-(\d+)(?:-(\d+))?/);
  if (!m) return { wins: 0, losses: 0, draws: 0 };
  return { wins: Number(m[1]), losses: Number(m[2]), draws: Number(m[3] || 0) };
}

function formatDateYMD(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

module.exports = async function handler(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);

  try {
    const now = new Date();
    const start = new Date(now.getTime() - 21 * 86400000);
    const end = new Date(now.getTime() + 90 * 86400000);
    const url = `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${formatDateYMD(start)}-${formatDateYMD(end)}`;

    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`ESPN API Error: ${response.status}`);
    }

    const data = await response.json();

    const events = (data.events || []).map(ev => {
      const fights = (ev.competitions || []).map((comp, idx) => {
        const compOdds = comp.odds?.[0] || null;
        const oddsDetails = compOdds?.details || 'Sem odds';
        const oddsOverUnder = compOdds?.overUnder || null;
        const homeMl = compOdds?.homeTeamOdds?.moneyLine;
        const awayMl = compOdds?.awayTeamOdds?.moneyLine;

        const fighters = (comp.competitors || []).map((fighter, fIdx) => {
          const athlete = fighter.athlete || {};
          const fullName = athlete.displayName || athlete.fullName || 'Unknown';
          const local = lookupLocalFighter(fullName);
          const photo = athlete.headshot?.href ||
            (fighter.id ? `https://a.espncdn.com/combiner/i?img=/i/headshots/mma/players/full/${fighter.id}.png` : '');

          const record = fighter.records?.[0]?.summary || (local.wins ? `${local.wins}-${local.losses}-${local.draws || 0}` : '0-0-0');
          const recNums = parseRecordNums(record);

          let decOdd = null;
          if (fIdx === 0 && homeMl != null) decOdd = americanToDecimal(homeMl);
          else if (fIdx === 1 && awayMl != null) decOdd = americanToDecimal(awayMl);

          return {
            id: fighter.id,
            name: fullName,
            shortName: athlete.shortName || fullName,
            photo,
            record,
            winner: Boolean(fighter.winner),
            corner: fighter.order === 1 ? 'red' : 'blue',
            odd: decOdd,
            height_cm: Number(local.height_cm) || 0,
            reach_cm: Number(local.reach_cm) || 0,
            stance: local.stance || '',
            style: local.style || 'MMA',
            age: Number(local.age) || 0,
            wins: recNums.wins || Number(local.wins) || 0,
            losses: recNums.losses || Number(local.losses) || 0,
            draws: recNums.draws || Number(local.draws) || 0
          };
        });

        const statusState = comp.status?.type?.state || 'pre';
        const completed = Boolean(comp.status?.type?.completed) || statusState === 'post';
        const methodText = comp.details?.[0]?.type?.text || comp.status?.type?.shortDetail || '';

        return {
          id: comp.id || `${ev.id}-${idx}`,
          date: comp.date || ev.date,
          status: statusState,
          completed,
          method: completed ? methodText : '',
          cardSegment: comp.cardSegment?.description || '',
          odds: compOdds ? {
            details: oddsDetails,
            overUnder: oddsOverUnder,
            oddA: fighters[0]?.odd || null,
            oddB: fighters[1]?.odd || null
          } : null,
          weightClass: comp.type?.abbreviation || comp.type?.text || 'Catchweight',
          fighters
        };
      });

      // A ESPN geralmente envia em ordem cronológica (Preliminar -> Luta Principal).
      // Garantimos que a Luta Principal fique sempre no índice 0 (topo da tela).
      const evTitle = normalizeName(ev.name);
      const isHeadliner = f => {
        const pair = (f.fighters || []).map(x => normalizeName(x.name).split(' ').pop()).filter(t => t.length > 2);
        return pair.length >= 2 && evTitle.includes(pair[0]) && evTitle.includes(pair[1]);
      };
      let orderedFights = fights;
      const headIdx = orderedFights.findIndex(isHeadliner);
      if (headIdx >= orderedFights.length / 2) {
        orderedFights = [...orderedFights].reverse();
      } else if (orderedFights.length > 1 && /main event/i.test(orderedFights[orderedFights.length - 1]?.cardSegment || '')) {
        orderedFights = [...orderedFights].reverse();
      }
      const finalHeadIdx = orderedFights.findIndex(isHeadliner);
      if (finalHeadIdx > 0) {
        const [main] = orderedFights.splice(finalHeadIdx, 1);
        orderedFights.unshift(main);
      }
      orderedFights.forEach((f, i) => {
        if (!f.cardSegment) {
          f.cardSegment = i === 0 ? '🏆 Luta Principal' : i === 1 ? '🔥 Co-Main Event' : i < 5 ? 'Card Principal' : 'Card Preliminar';
        }
      });

      return {
        id: ev.id,
        name: ev.name,
        shortName: ev.shortName,
        date: ev.date,
        completed: Boolean(ev.status?.type?.completed),
        fights: orderedFights
      };
    });

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600');
    res.status(200).json({ success: true, count: events.length, events });
  } catch (error) {
    console.error('ESPN Fetch Error:', error);
    res.status(error.name === 'AbortError' ? 504 : 500).json({ success: false, message: error.message });
  } finally {
    clearTimeout(timer);
  }
};
