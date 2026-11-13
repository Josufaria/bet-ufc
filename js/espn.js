document.addEventListener('DOMContentLoaded', () => {
  fetchEspnData();
});

async function fetchEspnData() {
  const container = document.getElementById('espn-container');
  if (!container) return;
  container.innerHTML = '<div class="spinner"></div><p style="text-align:center;">Carregando eventos da ESPN...</p>';

  try {
    // Chama nossa Serverless Function (com cache ativo)
    const response = await fetch('/api/get-espn-events');
    const result = await response.json();

    if (!result.success) throw new Error(result.message);

    renderEspnEvents(result.events);
  } catch (error) {
    container.innerHTML = `<div class="error" style="color:red; text-align:center;">Erro ao carregar ESPN: ${error.message}</div>`;
  }
}

function renderEspnEvents(events) {
  const container = document.getElementById('espn-container');
  container.innerHTML = '';

  if (events.length === 0) {
    container.innerHTML = '<p>Nenhum evento futuro encontrado.</p>';
    return;
  }

  events.forEach(event => {
    // Cria a seção do evento
    const eventSection = document.createElement('section');
    eventSection.className = 'espn-event-section';
    
    // Título do Evento
    const eventHeader = document.createElement('div');
    eventHeader.className = 'espn-event-header';
    eventHeader.innerHTML = `
      <h2>${event.name}</h2>
      <span class="event-date">📅 ${new Date(event.date).toLocaleString('pt-BR')}</span>
    `;
    eventSection.appendChild(eventHeader);

    // Grid de Lutas
    const fightsGrid = document.createElement('div');
    fightsGrid.className = 'espn-fights-grid';

    event.fights.forEach(fight => {
      // Ignora lutas sem lutadores
      if (!fight.fighters || fight.fighters.length < 2) return;
      
      const [f1, f2] = fight.fighters;
      const f1Odds = fight.odds ? fight.odds.details : 'Odds Indisponíveis';

      const card = document.createElement('div');
      card.className = 'espn-fight-card';
      
      card.innerHTML = `
        <!-- LUTADOR 1 (RED CORNER) -->
        <div class="espn-fighter ${f1.winner ? 'winner' : ''}">
          <div class="espn-photo-wrap">
            <img src="${f1.photo}" alt="${f1.name}" class="espn-headshot" onerror="this.onerror=null; this.src='https://a.espncdn.com/combiner/i?img=/i/headshots/mma/players/full/default.png';" />
          </div>
          <h4>${f1.name}</h4>
          <span class="espn-record">${f1.record}</span>
        </div>
        
        <!-- CENTRO DE APOSTAS -->
        <div class="espn-bet-center">
          <div class="espn-weightclass">${fight.weightClass}</div>
          <div class="espn-odds-badge">${f1Odds}</div>
          <div class="espn-input-group">
            <input type="text" placeholder="Seu Palpite (Ex: KO R2)" class="espn-bet-input" />
          </div>
        </div>

        <!-- LUTADOR 2 (BLUE CORNER) -->
        <div class="espn-fighter ${f2.winner ? 'winner' : ''}">
          <div class="espn-photo-wrap">
            <img src="${f2.photo}" alt="${f2.name}" class="espn-headshot" onerror="this.onerror=null; this.src='https://a.espncdn.com/combiner/i?img=/i/headshots/mma/players/full/default.png';" />
          </div>
          <h4>${f2.name}</h4>
          <span class="espn-record">${f2.record}</span>
        </div>
      `;

      fightsGrid.appendChild(card);
    });

    eventSection.appendChild(fightsGrid);
    container.appendChild(eventSection);
  });
}
