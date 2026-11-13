// Constantes
const GEMINI_API_URL = '/api/gemini';

// --- FUNÇÃO BASE DA API ---

async function callGemini(prompt) {
  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt: prompt })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Erro na comunicação com o servidor");
  }

  const data = await response.json();
  return data.result;
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
    // Busca contexto básico de TODOS os eventos e os picks oficiais do algoritmo
    let contextStr = "Nenhum dado atual carregado";
    if (typeof _eventos !== 'undefined' && _eventos.length > 0) {
      // Cria um resumo leve de todos os eventos
      const resumoEventos = _eventos.map(e => ({
        evento: e.nome,
        lutas: e.cardLutas ? e.cardLutas.map(l => `${l.fV} vs ${l.fA}`) : []
      }));
      
      const picksAlgoritmo = typeof window._activePicks !== 'undefined' ? window._activePicks : {};

      contextStr = `Eventos no Site: ${JSON.stringify(resumoEventos)}.\nPICKS OFICIAIS DO ALGORITMO (MUITO IMPORTANTE): ${JSON.stringify(picksAlgoritmo)}`;
    }
    
    const prompt = `Você é o Chatbot Assistente oficial do site UFC Bet Analyzer.
    Aqui está o contexto de lutas e os picks calculados pelo nosso algoritmo:
    ${contextStr}
    
    REGRA DE OURO (OBRIGATÓRIO): Se o usuário perguntar quem vai vencer uma luta, pedir um palpite, ou perguntar o que o algoritmo acha, você DEVE procurar os lutadores no JSON "PICKS OFICIAIS DO ALGORITMO" acima. Se o algoritmo tiver um pick (ex: "pick": "Nome do Lutador"), você DEVE OBRIGATORIAMENTE afirmar que o algoritmo prevê a vitória desse lutador. NUNCA, SOB HIPÓTESE ALGUMA, CONTRARIE O PICK DO ALGORITMO. Justifique a escolha do algoritmo usando o seu conhecimento de MMA. Se a luta não estiver nos picks oficiais, diga que não tem dados matemáticos suficientes e dê a sua própria opinião.
    
    Pergunta do usuário: "${message}"
    Responda de forma concisa e direta, agindo como um especialista em apostas.`;

    const aiResponse = await callGemini(prompt);
    // Limpa Markdown simples (*, **, etc)
      const safeResponse = aiResponse.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      
      aiDiv.innerHTML = safeResponse
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
  } catch (error) {
    aiDiv.textContent = `Erro: ${error.message}`;
    aiDiv.style.color = '#ff4a4a';
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
    "Favorito: [Nome] ([% de chance]%) - [Razão curta em uma frase]"`

    const aiResponse = await callGemini(prompt);
    
    targetElement.innerHTML = `
      <div class="ai-result">
        <strong>🤖 Análise de IA:</strong><br>
        ${aiResponse}
      </div>
    `;
  } catch (error) {
    targetElement.innerHTML = `<div class="ai-error">Erro na IA: ${error.message}</div>`;
  }
}
