const axios = require('axios');

async function test() {
  const r = await axios.get('http://www.ufcstats.com/statistics/fighters/search?query=alex+pereira&action=search', {
    headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 9000
  });
  const html = r.data;
  
  // Testa regex de link
  const linkRegex = /href="(http:\/\/www\.ufcstats\.com\/fighter-details\/[^"]+)"[^>]*>([^<]+)</i;
  const lm = html.match(linkRegex);
  console.log('Link:', lm ? lm[1] + ' -> ' + lm[2] : 'NAO ENCONTRADO');
  
  // Mostra trecho bruto
  const idx = html.indexOf('b-statistics__table-row');
  if (idx > -1) {
    const sample = html.substring(idx, idx + 800).replace(/\s+/g, ' ');
    console.log('Trecho tabela:', sample);
  } else {
    console.log('Classe nao encontrada. Primeiros 500 chars:', html.substring(0, 500));
  }
}

test().catch(e => console.error('ERRO:', e.message));
