const axios = require('axios');

async function testRecordTable(name) {
  console.log('\n=== Record Table:', name, '===');
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name + ' mma fighter')}&utf8=&format=json`;
  const r = await axios.get(searchUrl, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const title = r.data?.query?.search?.[0]?.title;
  if (!title) { console.log('NAO ENCONTRADO'); return; }

  const url2 = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(title)}&format=json`;
  const r2 = await axios.get(url2, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const pages = r2.data?.query?.pages;
  const rev = pages[Object.keys(pages)[0]].revisions?.[0];
  const content = rev.slots ? rev.slots.main['*'] : rev['*'];

  // Tenta extrair W–L da primeira linha da tabela de record
  // Formato: | Win || 27–1 || Stipe Miocic
  // ou: | style="..." | Win || 27–1–0 || 
  const tableRow = content.match(/\|\s*(?:style="[^"]*"\s*\|)?\s*(Win|Loss|Draw|NC)\s*\|\|\s*(\d{1,2}[–\-]\d{1,2}(?:[–\-]\d)?)/i);
  if (tableRow) {
    const record = tableRow[2];
    const parts = record.split(/[–\-]/);
    console.log('CARTEL DA TABELA:', tableRow[1], '| Record:', record, '→', parts[0]+'V', parts[1]+'D');
    
    // Agora conta todos os resultados da tabela para calcular o cartel completo
    const allRows = [...content.matchAll(/\|\s*(?:style="[^"]*"\s*\|)?\s*(Win|Loss|Draw|NC)\s*\|\|\s*\d+[–\-]\d+/gi)];
    console.log('Total de linhas encontradas na tabela:', allRows.length);
    
    // O cartel final é o da PRIMEIRA linha (mais recente)
    const wins = parseInt(parts[0]);
    const losses = parseInt(parts[1]);
    const draws = parts[2] ? parseInt(parts[2]) : 0;
    console.log(`→ Cartel final: ${wins}V - ${losses}D - ${draws}E`);
    
    // Extrai adversários das últimas 5 lutas
    const opponents = [];
    const fullRows = content.matchAll(/\|\s*(?:style="[^"]*"\s*\|)?\s*(Win|Loss|Draw|NC)\s*\|\|\s*\d+[–\-]\d+[–\-\d]*\s*\|\|\s*\[\[([^\]]+)\]\]/gi);
    for (const m of fullRows) {
      const result = m[1].trim();
      const opp = m[2].split('|').pop().trim();
      opponents.push({ result: result === 'Win' ? 'W' : result === 'Loss' ? 'L' : 'D', opponent: opp });
      if (opponents.length >= 5) break;
    }
    console.log('Adversários:', opponents);
  } else {
    console.log('TABELA NAO ENCONTRADA. Buscando padrao alternativo...');
    // Mostra trecho onde há Win ou Loss
    const idx = content.search(/\|\s*Win\s*\|\|/i);
    if (idx > -1) console.log('Contexto:', content.substring(idx, idx+150).replace(/\n/g, ' '));
    else console.log('Sem linha Win/Loss encontrada');
  }
}

async function run() {
  await testRecordTable('Jon Jones');
  await testRecordTable('Islam Makhachev');
  await testRecordTable('Alex Pereira');
}
run().catch(e => console.error(e.message));
