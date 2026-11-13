const { fetchFighterPhysicalData } = require('./fighter-data-fetcher');

module.exports = async function handler(req, res) {
  try {
    // Busca os dados da API pública da ESPN
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard');

    if (!response.ok) {
      throw new Error(`ESPN API Error: ${response.status}`);
    }

    const data = await response.json();

    // Mapeia e filtra o JSON gigante da ESPN para o que realmente importa pro Bet UFC
    const events = await Promise.all((data.events || []).map(async ev => {
      const fights = await Promise.all((ev.competitions || []).map(async comp => {
        // Busca as odds (se estiverem disponíveis) usando optional chaining rigoroso
        const oddsDetails = comp.odds?.[0]?.details || 'Sem odds';
        const oddsOverUnder = comp.odds?.[0]?.overUnder || null;
        const odds = comp.odds ? { details: oddsDetails, overUnder: oddsOverUnder } : null;

        const fightersRaw = await Promise.allSettled((comp.competitors || []).map(async fighter => {
          const athlete = fighter.athlete || {};
          const photo = athlete.headshot?.href || `https://a.espncdn.com/combiner/i?img=/i/headshots/mma/players/full/${fighter.id}.png`;

          // Dados físicos avançados agora vêm do módulo compartilhado,
          // que já tem cache de 7 dias por lutador. Na prática, isso
          // significa que a grande maioria das chamadas aqui nem chega
          // a bater na ESPN de novo — só lê do cache em memória.
          const physical = await fetchFighterPhysicalData(fighter.id);

          let record = '0-0-0';
          if (fighter.records && fighter.records.length > 0) {
            record = fighter.records[0].summary || record;
          }

          return {
            id: fighter.id,
            name: athlete.displayName || athlete.fullName || 'Unknown',
            shortName: athlete.shortName,
            photo: photo,
            record: record,
            winner: fighter.winner || false,
            corner: fighter.order === 1 ? 'red' : 'blue',

            // Dados Físicos Avançados Incorporados (vindos do cache compartilhado)
            height_cm: physical.height_cm,
            reach_cm: physical.reach_cm,
            stance: physical.stance,
            wins: physical.wins,
            losses: physical.losses,
            draws: physical.draws
          };
        }));

        const resolvedFighters = fightersRaw.map(r => {
          if (r.status === 'fulfilled') return r.value;
          return { id: null, name: 'Erro', photo: null, record: 'N/A' };
        });

        return {
          id: comp.id,
          date: comp.date,
          status: comp.status?.type?.state || 'pre', // 'pre', 'in', 'post'
          odds: odds,
          weightClass: comp.type?.abbreviation || 'Catchweight',
          fighters: resolvedFighters
        };
      }));

      return {
        id: ev.id,
        name: ev.name,
        shortName: ev.shortName,
        date: ev.date,
        fights: fights
      };
    }));

    // ESTRATÉGIA DE CACHE VERCEL (ISR / SWR)
    // s-maxage=21600 (6h) -> os dados físicos dos lutadores quase nunca
    //   mudam de um dia pro outro, e agora também temos cache por lutador
    //   de 7 dias no módulo compartilhado, então é seguro esticar isso.
    // stale-while-revalidate=86400 -> serve cache "velho" por até 24h
    //   enquanto revalida em background, garantindo resposta sempre rápida.
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');

    // Retorna o JSON otimizado
    res.status(200).json({ success: true, count: events.length, events });
  } catch (error) {
    console.error("ESPN Fetch Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
