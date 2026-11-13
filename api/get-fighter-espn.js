const { fetchFighterPhysicalData, fetchWithTimeout } = require('./fighter-data-fetcher');

module.exports = async (req, res) => {
  const name = req.query.name;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  let searchName = name;
  if (name.toLowerCase() === 'sharabutdin magomedov') {
    searchName = 'Shara Magomedov';
  }

  try {
    // 1. Search ESPN for the player
    const searchUrl = `https://site.api.espn.com/apis/search/v2?region=us&lang=en&query=${encodeURIComponent(searchName)}&limit=5&type=player`;
    const searchReq = await fetchWithTimeout(searchUrl);
    const searchData = await searchReq.json();

    let fighterId = null;
    let photoUrl = null;

    if (searchData && searchData.results && searchData.results.length > 0) {
      const players = searchData.results[0].contents;
      // Find the first MMA player
      const mmaPlayer = players.find(p => (p.sport || '').toLowerCase() === 'mma' || (p.description || '').toLowerCase() === 'mma');

      if (mmaPlayer) {
        if (mmaPlayer.uid) {
          const parts = mmaPlayer.uid.split('~a:');
          if (parts.length > 1) fighterId = parts[1];
        }
        if (!fighterId && mmaPlayer.id) {
          // fallback if uid is different
          fighterId = mmaPlayer.id; // Usually a guid, not the numerical ID, so uid is safer
        }

        if (mmaPlayer.image && mmaPlayer.image.default) {
          photoUrl = mmaPlayer.image.default;
        } else if (fighterId) {
          photoUrl = `https://a.espncdn.com/i/headshots/mma/players/full/${fighterId}.png`;
        }
      }
    }

    if (!fighterId) {
      return res.status(404).json({ error: 'Fighter not found on ESPN' });
    }

    // 2. Busca dados físicos (altura, envergadura, stance, cartel) através
    //    do módulo compartilhado — mesmo cache de 7 dias usado por
    //    get-espn-events.js, então se esse lutador já foi buscado por lá,
    //    a resposta aqui é instantânea.
    const physical = await fetchFighterPhysicalData(fighterId);

    // Cache no Edge por 7 dias (stats físicos raramente mudam)
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate');

    res.status(200).json({
      success: true,
      espnId: fighterId,
      name: name,
      photo: photoUrl,
      height_cm: physical.height_cm || 0,
      reach_cm: physical.reach_cm || 0,
      stance: physical.stance,
      wins: physical.wins,
      losses: physical.losses,
      draws: physical.draws
    });
  } catch (error) {
    console.error("ESPN Search Error:", error);
    res.status(500).json({ error: 'Failed to fetch ESPN data' });
  }
};
