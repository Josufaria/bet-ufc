/**
 * 🧠 MOTOR DE ANÁLISE MULTI-FATOR — UFC Bet Analyzer
 * 
 * Calcula probabilidades ajustadas considerando:
 *   1. Probabilidade implícita das odds (base)
 *   2. Vantagem física: altura (30%) + envergadura (70%)
 *   3. Matchup de estilos de luta (histórico)
 *   4. Fator zebra: padrão histórico da faixa de odds
 *   5. Fator idade: prime vs veterano vs jovem (NOVO)
 *   6. Finishing rate: taxa de finalização (NOVO)
 */

// ── WIN RATES POR MATCHUP DE ESTILO (dados históricos gerais do UFC) ──────────
const STYLE_WIN_RATES = {
  // Chave: "estilo_atacante vs estilo_oponente" → win rate do atacante
  "Striker vs Grappler":   0.52,  // Strikers ganham levemente contra grapplers
  "Grappler vs Striker":   0.48,  // Grapplers perdem levemente contra strikers
  "Striker vs All-Round":  0.50,  // Par
  "All-Round vs Striker":  0.50,  // Par
  "Grappler vs All-Round": 0.51,  // Leve vantagem grappler
  "All-Round vs Grappler": 0.49,  // Leve desvantagem
  "Wrestler vs Striker":   0.54,  // Wrestlers dominam strikers em geral
  "Striker vs Wrestler":   0.46,
  "Wrestler vs Grappler":  0.52,
  "Grappler vs Wrestler":  0.48,
  "Wrestler vs All-Round": 0.51,
  "All-Round vs Wrestler": 0.49,
};

// ── CATEGORIAS DE ODDS ─────────────────────────────────────────────────────────
const ODDS_CATS = [
  { key: 'superFav',   label: 'Super Favorito', faixa: '1.01–1.25', color: '#ffd700', min: 1.01, max: 1.25, icon: '⭐⭐⭐' },
  { key: 'muitoFav',  label: 'Muito Favorito',  faixa: '1.26–1.50', color: '#00d4ff', min: 1.26, max: 1.50, icon: '⭐⭐' },
  { key: 'fav',       label: 'Favorito',         faixa: '1.51–1.79', color: '#48bb78', min: 1.51, max: 1.79, icon: '⭐' },
  { key: 'parelho',   label: 'Parelho',           faixa: '1.80–2.50', color: '#a0aec0', min: 1.80, max: 2.50, icon: '⚖️' },
  { key: 'zebra',     label: 'Zebra',             faixa: '2.51–2.90', color: '#f6ad55', min: 2.51, max: 2.90, icon: '🦓' },
  { key: 'mZebra',   label: 'Muito Zebra',       faixa: '2.91–3.20', color: '#fc8181', min: 2.91, max: 3.20, icon: '🦓🦓' },
  { key: 'sZebra',   label: 'Super Zebra',       faixa: '3.21+',     color: '#e879f9', min: 3.21, max: 99.0, icon: '🦓🦓🦓' },
];

/**
 * Retorna a categoria de odds para um valor de odd
 */
function getOddsCat(odd) {
  return ODDS_CATS.find(c => odd >= c.min && odd <= c.max) || null;
}

/**
 * Calcula win rate histórico por matchup de estilo
 */
function getStyleWinRate(styleA, styleB) {
  if (!styleA || !styleB || styleA === styleB) return 0.50;
  const key = `${styleA} vs ${styleB}`;
  return STYLE_WIN_RATES[key] || 0.50;
}

/**
 * 📐 Calcula vantagem física normalizada (-1 a +1)
 * Envergadura tem 70% do peso, altura 30% (envergadura é mais relevante no striking)
 *
 * @param {object} fighterA - Dados do lutador A
 * @param {object} fighterB - Dados do lutador B
 * @returns {object} { total, heightAdv, reachAdv, heightDiff, reachDiff }
 */
function calcPhysicalAdvantage(fighterA, fighterB) {
  if (!fighterA || !fighterB) return { total: 0, heightAdv: 0, reachAdv: 0, heightDiff: 0, reachDiff: 0 };

  const hA = parseFloat(fighterA.height_cm);
  const hB = parseFloat(fighterB.height_cm);
  const rA = parseFloat(fighterA.reach_cm);
  const rB = parseFloat(fighterB.reach_cm);

  const heightDiff = (Number.isFinite(hA) && hA > 0 && Number.isFinite(hB) && hB > 0) ? Math.round((hA - hB) * 10) / 10 : 0;
  const reachDiff  = (Number.isFinite(rA) && rA > 0 && Number.isFinite(rB) && rB > 0) ? Math.round((rA - rB) * 10) / 10 : 0;

  // Normalizar: cada 5cm = ±0.25 de vantagem (máx ±1.0)
  const heightAdv = Math.max(-1, Math.min(1, heightDiff / 20));
  const reachAdv  = Math.max(-1, Math.min(1, reachDiff  / 20));

  // Envergadura vale 70%, altura vale 30%
  const total = (reachAdv * 0.70) + (heightAdv * 0.30);

  return { total, heightAdv, reachAdv, heightDiff, reachDiff };
}

/**
 * 🏆 Calcula vantagem de cartel (win rate relativo)
 */
function calcWinRateFactor(fA, fB) {
  function winRate(f) {
    if (!f) return null;
    const w = parseFloat(f.wins) || 0;
    const l = parseFloat(f.losses) || 0;
    const d = parseFloat(f.draws) || 0;
    const tot = w + l + d;
    if (tot < 3) return null;
    return w / tot;
  }
  const wrA = winRate(fA);
  const wrB = winRate(fB);
  if (wrA === null || wrB === null) return 0;
  return Math.max(-0.25, Math.min(0.25, (wrA - wrB)));
}

/**
 * 🥊 Prevê método provável de vitória com base nos estilos e taxa de finalização
 */
function predictFinishMethod(winnerFighter, probWinner) {
  const w = parseFloat(winnerFighter?.wins) || 0;
  const ko = parseFloat(winnerFighter?.ko_wins) || 0;
  const sub = parseFloat(winnerFighter?.sub_wins) || 0;
  if (w >= 4) {
    const koRate = ko / w;
    const subRate = sub / w;
    if (koRate >= 0.45 && koRate >= subRate) return 'KO/TKO';
    if (subRate >= 0.35 && subRate > koRate) return 'Submissão';
  }
  const style = (winnerFighter?.style || '').toLowerCase();
  if (style.includes('striker') || style.includes('kickbox') || style.includes('box') || style.includes('muay')) {
    return probWinner >= 0.62 ? 'KO/TKO' : 'Decisão';
  }
  if (style.includes('grappler') || style.includes('bjj') || style.includes('jiu')) {
    return probWinner >= 0.60 ? 'Submissão' : 'Decisão';
  }
  if (style.includes('wrestl')) return 'Decisão';
  return probWinner >= 0.68 ? 'Via Rápida' : 'Decisão';
}

/**
 * 🎂 Calcula fator de idade (-1 a +1)
 * Prime: 27–32 → bônus; Veterano >35 → penalidade; Jovem <24 → leve penalidade
 *
 * @param {number|null} ageA - Idade do lutador A
 * @param {number|null} ageB - Idade do lutador B
 * @returns {number} Fator de -0.5 a +0.5 (positivo = vantagem para A)
 */
function calcAgeFactor(ageA, ageB) {
  if (!ageA || !ageB) return 0;

  function agePrime(age) {
    if (age >= 27 && age <= 32) return  0.10;  // prime
    if (age >= 33 && age <= 35) return  0.00;  // ainda competitivo
    if (age > 35 && age <= 38)  return -0.08;  // veterano com queda
    if (age > 38)               return -0.15;  // declínio significativo
    if (age < 24)               return -0.05;  // jovem, ainda sem experiência
    return 0;
  }

  return agePrime(ageA) - agePrime(ageB); // relativo: vantagem de A sobre B
}

/**
 * 💥 Calcula fator de finishing rate
 * Lutadores com alta taxa de KO/Sub têm vantagem sobre decisão pura
 *
 * @param {object} fA - dados A (wins, ko_wins, sub_wins, dec_wins)
 * @param {object} fB - dados B
 * @returns {number} Fator de -0.3 a +0.3 (positivo = A é mais finalizador que B)
 */
function calcFinishingFactor(fA, fB) {
  function finishRate(f) {
    if (!f || !f.wins || f.wins === 0) return 0.5; // neutro sem dados
    const finishes = (f.ko_wins || 0) + (f.sub_wins || 0);
    return finishes / f.wins;
  }

  const frA = finishRate(fA);
  const frB = finishRate(fB);
  // Diferença de taxa de finalização → fator de -0.15 a +0.15
  return (frA - frB) * 0.30;
}

/**
 * 🎯 Motor principal de análise de luta
 * 
 * @param {string} nameA  - Nome do Lutador A
 * @param {string} nameB  - Nome do Lutador B
 * @param {number} oddsA  - Odd decimal do Lutador A
 * @param {number} oddsB  - Odd decimal do Lutador B
 * @param {object} fighterA - Dados físicos + cartel do Lutador A (do fighters-db)
 * @param {object} fighterB - Dados físicos + cartel do Lutador B (do fighters-db)
 * @param {object} zebraStats - Estatísticas históricas de zebras { hitRate, totalPicks }
 * @returns {object} Análise completa da luta
 */
function analyzeFight(nameA, nameB, oddsA, oddsB, fighterA, fighterB, zebraStats) {
  const result = {
    fighterA: nameA,
    fighterB: nameB,
    oddsA, oddsB,
    dataA: fighterA,
    dataB: fighterB,
    physical: {},
    styleA: fighterA?.style || null,
    styleB: fighterB?.style || null,
    probImplA: 0, probImplB: 0,
    probAdjA: 0, probAdjB: 0,
    evA: 0, evB: 0,
    confidenceA: 50, confidenceB: 50,
    pickRecommended: null,
    pickEV: 0,
    zebraAlert: false,
    zebraFighter: null,
    ageFactor: 0,
    finishingFactor: 0,
    factors: [],
  };

  // ── SEM ODDS DISPONÍVEIS ────────────────────────────────────────
  // Em eventos recém-anunciados, é comum a luta ainda não ter odds
  // publicadas pela casa de apostas. Antes, isso fazia a luta ficar
  // sem pick algum. Agora, damos um pick estimado baseado só em
  // física + estilo + idade + finishing rate (sem EV, sem prob.
  // implícita), e marcamos `pickIsEstimate: true` para a UI deixar
  // claro que esse pick não é baseado em odds reais.
  if (!oddsA || !oddsB || oddsA <= 1 || oddsB <= 1) {
    const physEst = calcPhysicalAdvantage(fighterA, fighterB);
    const styleWREst = getStyleWinRate(fighterA?.style, fighterB?.style);
    const styleFactorEst = styleWREst - 0.50;
    const ageFactorEst = calcAgeFactor(fighterA?.age, fighterB?.age);
    const finishingFactorEst = calcFinishingFactor(fighterA, fighterB);
    const winRateFactorEst = calcWinRateFactor(fighterA, fighterB);

    const score = (physEst.total * 0.35) + (styleFactorEst * 0.25) + (ageFactorEst * 0.15) + (finishingFactorEst * 0.05) + (winRateFactorEst * 0.20);
    const probAdjA = Math.max(0.20, Math.min(0.80, 0.50 + score * 0.55));
    const probAdjB = 1 - probAdjA;

    result.physical = physEst;
    result.ageFactor = ageFactorEst;
    result.finishingFactor = finishingFactorEst;
    result.probImplA = 0.50;
    result.probImplB = 0.50;
    result.probAdjA = probAdjA;
    result.probAdjB = probAdjB;
    result.oddsEstA = +(1 / probAdjA).toFixed(2);
    result.oddsEstB = +(1 / probAdjB).toFixed(2);
    result.confidenceA = Math.round(50 + Math.min(25, Math.abs(probAdjA - 0.5) * 90));
    result.confidenceB = 100 - result.confidenceA;
    result.pickRecommended = probAdjA >= probAdjB ? nameA : nameB;
    result.pickConf = Math.max(result.confidenceA, result.confidenceB);
    result.pickHasValue = false;
    result.pickIsEstimate = true;
    const winnerObj = probAdjA >= probAdjB ? fighterA : fighterB;
    result.predictedMethod = predictFinishMethod(winnerObj, Math.max(probAdjA, probAdjB));
    result.factors = buildFactors(physEst, styleWREst, fighterA, fighterB, 0.5, probAdjA, ageFactorEst, finishingFactorEst);
    return result;
  }

  // 1. Probabilidades implícitas (das odds)
  const rawProbA = 1 / oddsA;
  const rawProbB = 1 / oddsB;
  const totalProb = rawProbA + rawProbB; // > 1 por causa do overround da casa
  result.probImplA = rawProbA / totalProb; // normalizada
  result.probImplB = rawProbB / totalProb;

  // 2. Vantagem física
  const phys = calcPhysicalAdvantage(fighterA, fighterB);
  result.physical = phys;

  // 3. Win rate por estilo
  const styleWR_A = getStyleWinRate(fighterA?.style, fighterB?.style);
  const styleFactor = styleWR_A - 0.50; // -0.5 a +0.5

  // 4. Fator de idade & cartel
  const ageFactor = calcAgeFactor(fighterA?.age, fighterB?.age);
  result.ageFactor = ageFactor;
  const winRateFactor = calcWinRateFactor(fighterA, fighterB);

  // 5. Fator finishing rate
  const finishingFactor = calcFinishingFactor(fighterA, fighterB);
  result.finishingFactor = finishingFactor;

  // 6. Probabilidades ajustadas (multi-fator)
  const physWeight     = 0.12;  // máx 12% de ajuste por física
  const styleWeight    = 0.08;  // máx  8% de ajuste por estilo
  const ageWeight      = 0.05;  // máx  5% de ajuste por idade
  const finishWeight   = 0.03;  // máx  3% de ajuste por finishing rate
  const winRateWeight  = 0.06;  // máx  6% de ajuste por cartel

  let adjA = result.probImplA
    + (phys.total     * physWeight)
    + (styleFactor    * styleWeight)
    + (ageFactor      * ageWeight)
    + (finishingFactor * finishWeight)
    + (winRateFactor  * winRateWeight);

  // Clamp entre 2% e 98%
  adjA = Math.max(0.02, Math.min(0.98, adjA));
  const adjB = 1 - adjA;

  result.probAdjA = adjA;
  result.probAdjB = adjB;
  result.oddsEstA = +(1 / adjA).toFixed(2);
  result.oddsEstB = +(1 / adjB).toFixed(2);

  // 7. EV ajustado
  result.evA = (adjA * (oddsA - 1)) - (1 - adjA);
  result.evB = (adjB * (oddsB - 1)) - (1 - adjB);

  // 8. Score de confiança (0–100)
  const confA = 50
    + (result.probAdjA - result.probImplA) * 200     // ganho de prob
    + Math.min(15, Math.abs(phys.total) * 25)         // bônus física
    + (Math.abs(ageFactor) > 0.05 ? 5 : 0)           // bônus se há dados de idade
    + (result.evA > 0 ? 10 : -10);                    // bônus EV+

  const confB = 100 - confA;

  result.confidenceA = Math.round(Math.max(10, Math.min(90, confA)));
  result.confidenceB = Math.round(Math.max(10, Math.min(90, confB)));

  // 9. Pick recomendado
  if (result.evA >= result.evB) {
    result.pickRecommended = nameA;
    result.pickEV = result.evA;
    result.pickConf = result.confidenceA;
  } else {
    result.pickRecommended = nameB;
    result.pickEV = result.evB;
    result.pickConf = result.confidenceB;
  }
  result.pickHasValue = result.pickEV > 0;
  const pickIsA = result.pickRecommended === nameA;
  result.predictedMethod = predictFinishMethod(pickIsA ? fighterA : fighterB, pickIsA ? adjA : adjB);

  // 10. Fator zebra
  const catA = getOddsCat(oddsA);
  const catB = getOddsCat(oddsB);
  const underdog = oddsA > oddsB ? { name: nameA, odds: oddsA, cat: catA } : { name: nameB, odds: oddsB, cat: catB };

  if (underdog.cat && zebraStats) {
    const zStat = zebraStats[underdog.cat.key];
    if (zStat && zStat.picks >= 5) {
      const hitRate = zStat.acertos / zStat.picks;
      if (hitRate >= 0.32 && underdog.odds >= 2.50) {
        result.zebraAlert = true;
        result.zebraFighter = underdog.name;
        result.zebraHitRate = hitRate;
        result.zebraCat = underdog.cat;
      }
    }
  }

  // 11. Fatores explicativos
  result.factors = buildFactors(phys, styleWR_A, fighterA, fighterB, result.probImplA, adjA, ageFactor, finishingFactor);

  return result;
}

/**
 * Constrói lista de fatores explicativos da análise
 */
function buildFactors(phys, styleWR, fA, fB, probImpl, probAdj, ageFactor, finishingFactor) {
  const factors = [];

  if (phys.reachDiff !== 0) {
    const adv = phys.reachDiff > 0;
    factors.push({
      icon: '📏',
      label: 'Envergadura',
      value: `${adv ? '+' : ''}${phys.reachDiff}cm`,
      positive: adv,
      weight: 70,
    });
  }

  if (phys.heightDiff !== 0) {
    const adv = phys.heightDiff > 0;
    factors.push({
      icon: '📐',
      label: 'Altura',
      value: `${adv ? '+' : ''}${phys.heightDiff}cm`,
      positive: adv,
      weight: 30,
    });
  }

  if (fA?.style && fB?.style && fA.style !== fB.style) {
    const winRate = (styleWR * 100).toFixed(0);
    factors.push({
      icon: '🥊',
      label: `${fA.style} vs ${fB.style}`,
      value: `${winRate}% win rate`,
      positive: styleWR >= 0.50,
      weight: 8,
    });
  }

  if (ageFactor !== 0 && fA?.age && fB?.age) {
    const adv = ageFactor > 0;
    const label = Math.abs(ageFactor) >= 0.10 ? '🎂 Vantagem de Idade' : '🎂 Idade';
    factors.push({
      icon: '🎂',
      label,
      value: `${fA.age}a vs ${fB.age}a`,
      positive: adv,
      weight: 5,
    });
  }

  if (Math.abs(finishingFactor) > 0.02 && fA?.wins && fB?.wins) {
    const adv = finishingFactor > 0;
    const frA = fA.wins > 0 ? Math.round(((fA.ko_wins || 0) + (fA.sub_wins || 0)) / fA.wins * 100) : 0;
    const frB = fB.wins > 0 ? Math.round(((fB.ko_wins || 0) + (fB.sub_wins || 0)) / fB.wins * 100) : 0;
    factors.push({
      icon: '💥',
      label: 'Finishing Rate',
      value: `${frA}% vs ${frB}%`,
      positive: adv,
      weight: 3,
    });
  }

  const probDelta = ((probAdj - probImpl) * 100).toFixed(1);
  if (Math.abs(probAdj - probImpl) > 0.01) {
    factors.push({
      icon: '📊',
      label: 'Ajuste de probabilidade',
      value: `${probDelta > 0 ? '+' : ''}${probDelta}%`,
      positive: probDelta > 0,
      weight: 12,
    });
  }

  return factors;
}

/**
 * Classifica nível de confiança para exibição
 */
function getConfidenceLabel(score) {
  if (score >= 70) return { label: 'Alta Confiança', color: '#48bb78', cls: 'conf-high' };
  if (score >= 55) return { label: 'Confiança Média', color: '#f6ad55', cls: 'conf-med' };
  return { label: 'Baixa Confiança', color: '#fc8181', cls: 'conf-low' };
}

/**
 * Formata EV para exibição
 */
function formatEV(ev) {
  const n = +ev.toFixed(3);
  return {
    text: (n >= 0 ? '+' : '') + n.toFixed(3),
    positive: n > 0,
    cls: n > 0 ? 'ev-pos' : n < 0 ? 'ev-neg' : 'ev-neu',
  };
}

/**
 * Formata probabilidade para exibição
 */
function formatProb(prob) {
  return (prob * 100).toFixed(1) + '%';
}
