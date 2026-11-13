const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../eventos_futuros.txt');

async function getNextEvent() {
  try {
    console.log('Buscando eventos no UFCStats.com...');
    const { data } = await axios.get('http://ufcstats.com/statistics/events/upcoming');
    const $ = cheerio.load(data);
    
    // Pegar o link do primeiro evento (próximo evento)
    const eventLink = $('.b-link.b-link_style_black').first().attr('href');
    const eventName = $('.b-link.b-link_style_black').first().text().trim();
    const eventDate = $('.b-list__box-list-item').first().text().replace('Date:', '').trim();

    console.log(`Próximo evento encontrado: ${eventName} (${eventDate})`);
    
    // Entrar na página do evento
    const eventPage = await axios.get(eventLink);
    const $$ = cheerio.load(eventPage.data);
    
    const fights = [];
    
    $$('.b-fight-details__table-row').each((i, el) => {
      // Pular cabeçalho
      if (i === 0) return;
      
      const fighters = $$(el).find('.b-link.b-link_style_black');
      if (fighters.length === 2) {
        const f1 = $$(fighters[0]).text().trim();
        const f2 = $$(fighters[1]).text().trim();
        
        fights.push({
          f1: f1,
          f2: f2,
          winner: "",
          method: "",
          oV: 0,
          oA: 0,
          fisico: "A analisar",
          probReal: "",
          ev: "",
          pick: "",
          met: "",
          nota: "Pendente"
        });
      }
    });

    const eventData = {
      name: eventName,
      date: eventDate,
      fights: fights
    };

    console.log(`Encontradas ${fights.length} lutas. Salvando em eventos_futuros.txt...`);
    
    let currentData = [];
    if (fs.existsSync(DB_PATH)) {
      const fileContent = fs.readFileSync(DB_PATH, 'utf-8');
      try {
        currentData = JSON.parse(fileContent);
      } catch (e) {
        // Se falhar, assume array vazio
        currentData = [];
      }
    }
    
    // Adicionar no início se não existir
    if (!currentData.find(e => e.name === eventName)) {
      currentData.unshift(eventData);
      fs.writeFileSync(DB_PATH, JSON.stringify(currentData, null, 2), 'utf-8');
      console.log('✅ Evento salvo com sucesso!');
    } else {
      console.log('⚠️ O evento já existe na base de dados.');
    }

  } catch (error) {
    console.error('Erro ao buscar dados:', error.message);
  }
}

getNextEvent();
