// Constantes
const GEMINI_API_URL = '/api/gemini';
const GEMINI_TIMEOUT_MS = 4000;

function escapeAiHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatChatMarkdown(text) {
  const safeResponse = escapeAiHtml(text);
  return safeResponse
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function normalizeSearchText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// --- FUNÇÃO BASE DA API ---

async function callGemini(prompt) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS) : null;

  try {
    const fetchOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt: prompt })
    };
    if (controller) fetchOpts.signal = controller.signal;

    const response = await fetch(GEMINI_API_URL, fetchOpts);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Servidor IA indisponível (${response.status})`);
    }

    const data = await response.json().catch(() => ({}));
    if (!data || !data.result) {
      throw new Error('Resposta vazia da IA');
    }
    return data.result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// --- CONTEXTO ENXUTO & MODELO TÁTICO LOCAL (FALLBACK OFFLINE) ---

function buildGeminiContext() {
  if (typeof _eventos === 'undefined' || !_eventos.length) {
    return 'Nenhum dado atual carregado.';
  }

  const selNome = typeof document !== 'undefined' ? (document.getElementById('evento-sel')?.value || '') : '';
  const eventosRelevantes = [];
  const vistos = new Set();

  for (const e of _eventos) {
    if (e.isFuturo || (selNome && e.nome === selNome)) {
      if (!vistos.has(e.nome)) {
        vistos.add(e.nome);
        eventosRelevantes.push({
          evento: e.nome,
          data: e.dataEvento,
          futuro: !!e.isFuturo,
          lutas: (e.cardLutas || []).map(l => `${l.fV} vs ${l.fA}`)
        });
      }
    }
  }

  // Caso não haja futuros nem selecionado, envia no máximo os 2 mais recentes
  if (!eventosRelevantes.length) {
    for (const e of _eventos.slice(0, 2)) {
      eventosRelevantes.push({
        evento: e.nome,
        data: e.dataEvento,
        futuro: !!e.isFuturo,
        lutas: (e.cardLutas || []).map(l => `${l.fV} vs ${l.fA}`)
      });
    }
  }

  const picksAlgoritmo = typeof window._activePicks !== 'undefined' ? window._activePicks : {};
  return `Evento Selecionado: ${selNome || 'Nenhum'}\nEventos Relevantes: ${JSON.stringify(eventosRelevantes)}.\nPICKS OFICIAIS DO ALGORITMO (MUITO IMPORTANTE): ${JSON.stringify(picksAlgoritmo)}`;
}

function splitFightString(lutaStr) {
  const parts = String(lutaStr || '').split(/\s+vs\s+/i);
  if (parts.length === 2) return [parts[0].trim(), parts[1].trim()];
  return ['', ''];
}

function findFightContext(f1Name, f2Name) {
  if (typeof _eventos === 'undefined' || !_eventos.length) return { fight: null, analysis: null };
  const n1 = normalizeSearchText(f1Name);
  const n2 = normalizeSearchText(f2Name);
  const selNome = typeof document !== 'undefined' ? (document.getElementById('evento-sel')?.value || '') : '';

  const ordered = [];
  const selected = _eventos.find(e => e.nome === selNome);
  if (selected) ordered.push(selected);
  for (const e of _eventos) {
    if (e !== selected) ordered.push(e);
  }

  for (const ev of ordered) {
    const analysis = (ev.punterAnalise || []).find(p => {
      const [pa, pb] = p.fV && p.fA ? [p.fV, p.fA] : splitFightString(p.luta);
      const a = normalizeSearchText(pa);
      const b = normalizeSearchText(pb);
      return (a === n1 && b === n2) || (a === n2 && b === n1);
    });
    const fight = (ev.cardLutas || []).find(l => {
      const a = normalizeSearchText(l.fV);
      const b = normalizeSearchText(l.fA);
      return (a === n1 && b === n2) || (a === n2 && b === n1);
    });
    if (fight || analysis) {
      return { fight: fight || null, analysis: analysis || null, evento: ev };
    }
  }
  return { fight: null, analysis: null, evento: null };
}

function formatFighterLine(name, db) {
  if (!db) return `${name}: sem ficha física detalhada`;
  const rec = (db.wins != null && db.losses != null) ? `${db.wins}-${db.losses}${db.draws ? '-' + db.draws : ''}` : '';
  const parts = [];
  if (db.style) parts.push(db.style);
  if (rec) parts.push(`cartel ${rec}`);
  if (db.height_cm) parts.push(`${db.height_cm}cm alt.`);
  if (db.reach_cm) parts.push(`${db.reach_cm}cm env.`);
  return `${name} (${parts.join(', ')})`;
}

function generateLocalFightAnalysis(f1Name, f2Name, algorithmPick) {
  const db1 = typeof getFighterData === 'function' ? getFighterData(f1Name) : null;
  const db2 = typeof getFighterData === 'function' ? getFighterData(f2Name) : null;
  const ctx = findFightContext(f1Name, f2Name);

  let o1 = 0;
  let o2 = 0;
  if (ctx.fight) {
    if (normalizeSearchText(ctx.fight.fV) === normalizeSearchText(f1Name)) {
      o1 = ctx.fight.oV || 0;
      o2 = ctx.fight.oA || 0;
    } else {
      o1 = ctx.fight.oA || 0;
      o2 = ctx.fight.oV || 0;
    }
  }

  let computed = null;
  if (typeof analyzeFight === 'function') {
    const eloCtx = typeof getFighterEloCtx === 'function' ? getFighterEloCtx(f1Name, f2Name, ctx.fight) : null;
    computed = analyzeFight(f1Name, f2Name, o1, o2, db1, db2, null, eloCtx);
  }

  const analysis = computed || ctx.analysis || null;
  let favored = algorithmPick || (analysis && (analysis.pickRecommended || analysis.pick)) || f1Name;
  let probPct = 58;
  const reasons = [];

  if (computed && (computed.probAdjA != null || computed.probA != null)) {
    const normFav = normalizeSearchText(favored);
    const pA = computed.probAdjA != null ? computed.probAdjA : computed.probA;
    const pB = computed.probAdjB != null ? computed.probAdjB : computed.probB;
    const isF1 = normalizeSearchText(f1Name) === normFav;
    const chosenProb = isF1 ? pA : (normalizeSearchText(f2Name) === normFav ? pB : Math.max(pA, pB));
    probPct = Math.round(Math.max(0.51, Math.min(0.95, chosenProb)) * 100);
    if (computed.predictedMethod) {
      reasons.push(`método projetado: ${computed.predictedMethod}`);
    }
    if (Array.isArray(computed.motivos) && computed.motivos.length) {
      reasons.push(computed.motivos.slice(0, 2).join('; '));
    }
  } else if (ctx.analysis && ctx.analysis.probReal) {
    const parsedProb = parseFloat(String(ctx.analysis.probReal).replace('%', ''));
    if (Number.isFinite(parsedProb) && parsedProb > 0) {
      probPct = Math.round(Math.max(51, Math.min(95, parsedProb)));
    }
    if (ctx.analysis.nota) reasons.push(ctx.analysis.nota);
  }

  const favIs1 = normalizeSearchText(favored) === normalizeSearchText(f1Name);
  const favDb = favIs1 ? db1 : db2;
  const dogDb = favIs1 ? db2 : db1;
  const dogName = favIs1 ? f2Name : f1Name;

  if (favDb && dogDb) {
    if (favDb.reach_cm && dogDb.reach_cm && (favDb.reach_cm - dogDb.reach_cm) >= 5) {
      reasons.push(`vantagem de ${favDb.reach_cm - dogDb.reach_cm}cm de envergadura`);
    }
    if (favDb.wins != null && favDb.losses != null && dogDb.wins != null && dogDb.losses != null) {
      const wr1 = favDb.wins / Math.max(1, favDb.wins + favDb.losses);
      const wr2 = dogDb.wins / Math.max(1, dogDb.wins + dogDb.losses);
      if (wr1 - wr2 >= 0.08) {
        reasons.push(`aproveitamento superior (${favDb.wins}-${favDb.losses} vs ${dogDb.wins}-${dogDb.losses})`);
      }
    }
    if (favDb.style && dogDb.style && favDb.style !== dogDb.style) {
      reasons.push(`duelo de estilos (${favDb.style} vs ${dogDb.style})`);
    }
  }

  if (typeof window !== 'undefined' && window._fighterElo) {
    const e1 = window._fighterElo[normalizeSearchText(favored)] || 1500;
    const e2 = window._fighterElo[normalizeSearchText(dogName)] || 1500;
    if (e1 - e2 >= 30) {
      reasons.push(`rating Elo superior (${Math.round(e1)} vs ${Math.round(e2)})`);
    }
  }

  if (!reasons.length) {
    reasons.push(`projeção estatística favorável para ${favored} considerando odds e base histórica de lutadores (${formatFighterLine(f1Name, db1)} vs ${formatFighterLine(f2Name, db2)})`);
  }

  return `Favorito: ${favored} (${probPct}%) - ${reasons.join('; ')}.`;
}

function matchesTokenInText(normMsg, fullName) {
  const normName = normalizeSearchText(fullName);
  if (!normName) return false;
  if (normMsg.includes(normName)) return true;
  const parts = normName.split(/\s+/).filter(p => p.length >= 4);
  if (!parts.length) return false;
  const last = parts[parts.length - 1];
  return new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(normMsg);
}

function generateLocalChatReply(message) {
  const normMsg = normalizeSearchText(message);
  const picksRaw = typeof window !== 'undefined' && window._activePicks ? window._activePicks : [];
  const picksList = Array.isArray(picksRaw)
    ? picksRaw
    : Object.entries(picksRaw).map(([fight, val]) => ({ fight, ...(val || {}) }));
  const selNome = typeof document !== 'undefined' ? (document.getElementById('evento-sel')?.value || '') : '';
  const eventos = typeof _eventos !== 'undefined' ? _eventos : [];

  // 1. Verifica se o usuário perguntou sobre uma luta ou lutador nos picks ativos (prioriza evento selecionado)
  const prioritizedPicks = [
    ...picksList.filter(p => p.event === selNome),
    ...picksList.filter(p => p.event !== selNome)
  ];
  for (const item of prioritizedPicks) {
    const [f1, f2] = splitFightString(item.fight || item.luta);
    if (f1 && f2 && (matchesTokenInText(normMsg, f1) || matchesTokenInText(normMsg, f2))) {
      const rec = generateLocalFightAnalysis(f1, f2, item.pick);
      const extra = [];
      if (item.met) extra.push(`Método: ${item.met}`);
      if (item.ev) extra.push(`EV: ${item.ev}`);
      return `**[Modelo Estatístico Local — ${item.event || 'Próximo Card'}]** Para **${f1} vs ${f2}**:\n${rec}${extra.length ? '\n' + extra.join(' · ') : ''}`;
    }
  }

  // 2. Verifica todos os eventos carregados por lutador mencionado
  const orderedEvents = [];
  const selectedEv = eventos.find(e => e.nome === selNome);
  if (selectedEv) orderedEvents.push(selectedEv);
  for (const e of eventos) {
    if (e !== selectedEv) orderedEvents.push(e);
  }

  for (const ev of orderedEvents) {
    for (const p of (ev.punterAnalise || [])) {
      const [f1, f2] = p.fV && p.fA ? [p.fV, p.fA] : splitFightString(p.luta);
      if (f1 && f2 && (matchesTokenInText(normMsg, f1) || matchesTokenInText(normMsg, f2))) {
        const rec = generateLocalFightAnalysis(f1, f2, p.pick);
        const statusTxt = ev.isFuturo ? 'Próximo card' : 'Evento finalizado';
        return `**[Modelo Estatístico Local — ${ev.nome}]**\n**${f1} vs ${f2}** (${statusTxt})\n${rec}`;
      }
    }
    for (const c of (ev.cardLutas || [])) {
      if (matchesTokenInText(normMsg, c.fV) || matchesTokenInText(normMsg, c.fA)) {
        const rec = generateLocalFightAnalysis(c.fV, c.fA, '');
        const statusTxt = ev.isFuturo ? 'Próximo card' : (c.resultado || 'Evento finalizado');
        return `**[Modelo Estatístico Local — ${ev.nome}]**\n**${c.fV} vs ${c.fA}** (${statusTxt})\n${rec}`;
      }
    }
  }

  // 3. Pergunta geral sobre o evento atual, próximos cards ou melhores apostas
  const targetEv = selectedEv || eventos.find(e => e.isFuturo) || eventos[0];
  if (targetEv && (targetEv.punterAnalise || []).length) {
    const getProbNum = (p) => {
      if (p.probReal) {
        const n = parseFloat(String(p.probReal).replace('%', ''));
        if (Number.isFinite(n)) return n;
      }
      return p.prob ? Math.round(p.prob * 100) : 55;
    };
    const topPicks = [...targetEv.punterAnalise]
      .sort((a, b) => getProbNum(b) - getProbNum(a))
      .slice(0, 4);
    const linhas = topPicks.map(p => {
      const pct = Math.round(getProbNum(p));
      const oddVal = p.odd || (typeof findOdds === 'function' ? findOdds(targetEv.oddCard, p.pick) : 0);
      const oddStr = oddVal ? ` @ ${Number(oddVal).toFixed(2)}` : '';
      const fightLabel = p.luta || `${p.fV || ''} vs ${p.fA || ''}`.trim();
      return `• **${p.pick}** (${pct}%${oddStr}) em ${fightLabel}`;
    });
    return `**[Modo Offline — IA Cloud indisponível]** Aqui estão os principais destaques do algoritmo para **${targetEv.nome}**:\n${linhas.join('\n')}\n\nPergunte pelo nome de qualquer lutador do card para ver a análise tática detalhada.`;
  }

  return '**[Modo Offline]** O servidor de IA cloud está indisponível no momento, mas o motor estatístico local (Elo + Envergadura + De-Vig) está ativo. Pergunte o nome de um lutador ou selecione um evento no topo para ver os melhores picks.';
}

// --- CHATBOT ---

function toggleChatbot() {
  const chatWindow = document.getElementById('chatbot-window');
  if (chatWindow.style.display === 'none' || chatWindow.style.display === '') {
    chatWindow.style.display = 'flex';
  } else {
    chatWindow.style.display = 'none';
  }
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  const chatBody = document.getElementById('chat-body');

  // Adiciona msg do usuário
  const userDiv = document.createElement('div');
  userDiv.className = 'chat-message user-message';
  userDiv.textContent = message;
  chatBody.appendChild(userDiv);

  input.value = '';

  // Cria div de loading para a IA
  const aiDiv = document.createElement('div');
  aiDiv.className = 'chat-message ai-message';
  aiDiv.innerHTML = '<span class="loading-dots">...</span>';
  chatBody.appendChild(aiDiv);

  chatBody.scrollTop = chatBody.scrollHeight;

  try {
    const contextStr = buildGeminiContext();

    const prompt = `Você é o Chatbot Assistente oficial do site UFC Bet Analyzer.
    Aqui está o contexto de lutas e os picks calculados pelo nosso algoritmo:
    ${contextStr}
    
    REGRA DE OURO (OBRIGATÓRIO): Se o usuário perguntar quem vai vencer uma luta, pedir um palpite, ou perguntar o que o algoritmo acha, você DEVE procurar os lutadores no JSON "PICKS OFICIAIS DO ALGORITMO" acima. Se o algoritmo tiver um pick (ex: "pick": "Nome do Lutador"), você DEVE OBRIGATORIAMENTE afirmar que o algoritmo prevê a vitória desse lutador. NUNCA, SOB HIPÓTESE ALGUMA, CONTRARIE O PICK DO ALGORITMO. Justifique a escolha do algoritmo usando o seu conhecimento de MMA. Se a luta não estiver nos picks oficiais, diga que não tem dados matemáticos suficientes e dê a sua própria opinião.
    
    Pergunta do usuário: "${message}"
    Responda de forma concisa e direta, agindo como um especialista em apostas.`;

    const aiResponse = await callGemini(prompt);
    aiDiv.style.color = '';
    aiDiv.innerHTML = formatChatMarkdown(aiResponse);
  } catch (error) {
    aiDiv.style.color = '';
    aiDiv.innerHTML = formatChatMarkdown(generateLocalChatReply(message));
  }

  chatBody.scrollTop = chatBody.scrollHeight;
}

// --- PREVISÃO DE LUTAS ---

async function analyzeFightWithAI(f1Name, f2Name, cardElementId, algorithmPick) {
  const targetElement = document.getElementById(cardElementId);
  if (!targetElement) return;

  targetElement.innerHTML = '<div class="ai-loading">A IA está analisando...</div>';

  try {
    // Busca dados dos lutadores no banco de dados se disponível
    const db1 = typeof getFighterData === 'function' ? getFighterData(f1Name) : null;
    const db2 = typeof getFighterData === 'function' ? getFighterData(f2Name) : null;

    const stats1 = db1 ? `Altura: ${db1.height_cm}cm, Envergadura: ${db1.reach_cm}cm, Estilo: ${db1.style}` : 'Dados físicos não registrados';
    const stats2 = db2 ? `Altura: ${db2.height_cm}cm, Envergadura: ${db2.reach_cm}cm, Estilo: ${db2.style}` : 'Dados físicos não registrados';

    const pickContext = algorithmPick ? `\nO nosso algoritmo estatístico recomenda apostar em: ${algorithmPick}.` : '';

    const prompt = `Analise a luta de UFC entre ${f1Name} e ${f2Name}. 
    Estatísticas do ${f1Name}: ${stats1}.
    Estatísticas do ${f2Name}: ${stats2}.${pickContext}
    
    Aja como o analista do site. Alinhe sua previsão com o algoritmo do site se houver recomendação, justificando o porquê essa é uma boa aposta com base nos estilos e vantagem física. Se não houver recomendação, escolha o provável vencedor.
    
    Retorne uma resposta estrita e curta no seguinte formato exato (sem aspas):
    "Favorito: [Nome] ([% de chance]%) - [Razão curta em uma frase]"`;

    const aiResponse = await callGemini(prompt);

    targetElement.innerHTML = `
      <div class="ai-result">
        <strong>🤖 Análise de IA:</strong><br>
        ${escapeAiHtml(aiResponse).replace(/\n/g, '<br>')}
      </div>
    `;
  } catch (error) {
    const localSummary = generateLocalFightAnalysis(f1Name, f2Name, algorithmPick);
    targetElement.innerHTML = `
      <div class="ai-result">
        <strong>📊 Análise Tática Local (Modo Offline):</strong><br>
        ${escapeAiHtml(localSummary)}
      </div>
    `;
  }
}
