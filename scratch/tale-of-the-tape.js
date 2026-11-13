// NOVO BUILD FIGHT CARD
function buildFightCard(c, ev, idx) {
  const { fV, oV, fA, oA } = c;
  if (!fV && !fA) return '';

  const editIconV = fV ? `<span class="fc-edit-btn" onclick="openFighterModal('${fV.replace(/'/g, "\\\\'")}')" title="Editar dados físicos de ${fV}">✏️</span>` : '';
  const editIconA = fA ? `<span class="fc-edit-btn" onclick="openFighterModal('${fA.replace(/'/g, "\\\\'")}')" title="Editar dados físicos de ${fA}">✏️</span>` : '';

  // Dados do DB de lutadores
  let dbA = typeof getFighterData === 'function' ? getFighterData(fV) : null;
  let dbB = typeof getFighterData === 'function' ? getFighterData(fA) : null;

  // Usa dados da ESPN como fallback
  const mapEspnDb = (espnFighter) => {
    if (!espnFighter) return null;
    let rec = espnFighter.records && espnFighter.records.length > 0 ? espnFighter.records[0].summary : null;
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
      wins: w, losses: l, draws: d,
      height_cm: '—', reach_cm: '—', stance: '', style: '' 
    };
  };

  if (c.f1Obj) dbA = { ...(dbA || {}), ...mapEspnDb(c.f1Obj) };
  if (c.f2Obj) dbB = { ...(dbB || {}), ...mapEspnDb(c.f2Obj) };

  // Fila Inteligente ESPN (_espnQueue)
  if (!window._espnQueue) {
    window._espnQueue = [];
    window._espnProcessing = false;
    window._fetchingEspn = {};
    window._processEspnQueue = async function() {
      if (window._espnProcessing || window._espnQueue.length === 0) return;
      window._espnProcessing = true;
      const fighter = window._espnQueue.shift();
      
      try {
        console.log(`[ESPN Queue] Buscando dados de: ${fighter}`);
        const r = await fetch(`/api/get-fighter-espn?name=${encodeURIComponent(fighter)}`);
        
        if (r.ok) {
           const data = await r.json();
           if (data.success) {
              console.log(`[ESPN Queue] Encontrado: ${fighter} (${data.espnId})`);
              if (typeof saveCustomFighter === 'function') {
                const existingDb = typeof getFighterData === 'function' ? getFighterData(fighter) : {};
                saveCustomFighter(fighter, {
                  ...existingDb,
                  height_cm: data.height_cm || existingDb.height_cm,
                  reach_cm: data.reach_cm || existingDb.reach_cm,
                  stance: data.stance || existingDb.stance,
                  espn_photo: data.photo,
                  not_found_espn: false
                });
                if (typeof refreshFighterCards === 'function') {
                   refreshFighterCards(fighter);
                }
              }
           }
        } else if (r.status === 404) {
           window._fetchingEspn[fighter] = 'not_found';
           if (typeof saveCustomFighter === 'function') {
             const existingDb = typeof getFighterData === 'function' ? getFighterData(fighter) : {};
             saveCustomFighter(fighter, { ...existingDb, not_found_espn: true });
           }
        }
      } catch (e) {
        console.error("[ESPN Queue] Erro ao buscar stats para", fighter, e);
      }

      // Delay de 1 segundo
      setTimeout(() => {
        window._espnProcessing = false;
        window._processEspnQueue();
      }, 1000);
    };
  }

  [fV, fA].forEach(fighter => {
    if (!fighter) return;
    const db = typeof getFighterData === 'function' ? getFighterData(fighter) : null;
    const semFotoOuFisico = !db || !db.espn_photo || !db.height_cm;
    const jaTentouEspn = db && db.not_found_espn === true;
    
    // Nao enfileira se ja foi passado a foto via c.espnPhotoV
    let hasDirectPhoto = (fighter === fV && c.espnPhotoV) || (fighter === fA && c.espnPhotoA);
    
    if (semFotoOuFisico && !window._fetchingEspn[fighter] && !jaTentouEspn && !hasDirectPhoto) {
      window._fetchingEspn[fighter] = true;
      window._espnQueue.push(fighter);
      window._processEspnQueue();
    }
  });

  // Fotos Definitivas (ESPN Scoreboard, DB Local ou Skeleton Fallback)
  const defaultPhoto = 'https://a.espncdn.com/combiner/i?img=/i/headshots/mma/players/full/default.png';
  let photoV = c.espnPhotoV || dbA?.espn_photo;
  let photoA = c.espnPhotoA || dbB?.espn_photo;
  
  // Se ainda estiver buscando, mostra Skeleton pra foto
  const isFetchingV = window._fetchingEspn[fV] === true && !photoV;
  const isFetchingA = window._fetchingEspn[fA] === true && !photoA;

  const renderPhoto = (url, name, isFetching) => {
    if (isFetching) return `<div class="tale-skeleton"><div class="skel-photo"></div></div>`;
    const finalUrl = url || defaultPhoto;
    return `<div class="tale-photo-wrap"><img src="${finalUrl}" class="tale-photo" onerror="this.onerror=null; this.src='${defaultPhoto}';" /></div>`;
  };

  // Formatadores Tale
  const fRecord = (db) => db && db.wins !== undefined && db.wins !== null ? `${db.wins}-${db.losses}${db.draws > 0 ? '-'+db.draws : ''}` : '—';
  const fHeight = (db) => db && db.height_cm ? `${db.height_cm} cm` : '—';
  const fReach = (db) => db && db.reach_cm ? `${db.reach_cm} cm` : '—';
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
    </div>
  `;
}
