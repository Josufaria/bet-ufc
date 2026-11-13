const axios = require('axios');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testCount(name) {
  console.log('\n=== Count method:', name, '===');
  await sleep(2000); // respeita rate limit

  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name + ' mma fighter')}&utf8=&format=json`;
  const r = await axios.get(searchUrl, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const title = r.data?.query?.search?.[0]?.title;
  if (!title || !title.toLowerCase().includes(name.toLowerCase().split(' ')[0])) {
    console.log('NAO ENCONTRADO'); return;
  }
  
  await sleep(1000);
  const url2 = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(title)}&format=json`;
  const r2 = await axios.get(url2, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const pages = r2.data?.query?.pages;
  const rev = pages[Object.keys(pages)[0]].revisions?.[0];
  const content = rev.slots ? rev.slots.main['*'] : rev['*'];

  // METODO 1: Contar linhas Win/Loss/Draw na tabela
  const wins   = (content.match(/\|\s*Win\s*\|\|/gi)  || []).length;
  const losses  = (content.match(/\|\s*Loss\s*\|\|/gi) || []).length;
  const draws   = (content.match(/\|\s*Draw\s*\|\|/gi) || []).length;
  const nc      = (content.match(/\|\s*NC\s*\|\|/gi)   || []).length;
  console.log(`Método contagem: ${wins}V - ${losses}D - ${draws}E (${nc} NC)`);

  // METODO 2: Pegar o record da primeira linha da tabela
  const firstRow = content.match(/\|\s*(?:style="[^"]*"\s*\|)?\s*(Win|Loss|Draw|NC)\s*\|\|\s*(\d{1,2}[–\-]\d{1,2}(?:[–\-]\d)?)/i);
  if (firstRow) {
    const parts = firstRow[2].split(/[–\-]/);
    console.log(`Método primeira linha: ${firstRow[1]} | Cartel: ${firstRow[2]} → ${parts[0]}V ${parts[1]}D`);
  }

  // KO/Sub/Dec - usando método alternativo: contar métodos nas colunas
  const koWins  = (content.match(/\|\s*Win\s*\|\|[^|]+\|\|[^|]*(?:KO|TKO)/gi) || []).length;
  const subWins = (content.match(/\|\s*Win\s*\|\|[^|]+\|\|[^|]*(?:Sub|Submission)/gi) || []).length;
  const decWins = (content.match(/\|\s*Win\s*\|\|[^|]+\|\|[^|]*(?:Dec|Decision|Unanimous|Split|Majority)/gi) || []).length;
  console.log(`Métodos: KO=${koWins} Sub=${subWins} Dec=${decWins}`);

  // Histórico de adversários - pegar primeiro campo após o record
  const oppMatches = [...content.matchAll(/\|\s*(?:style="[^"]*"\s*\|)?\s*(Win|Loss|Draw|NC)\s*\|\|\s*[\d–\-]+\s*\|\|\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gi)];
  const history = oppMatches.slice(0, 5).map(m => ({
    result: m[1] === 'Win' ? 'W' : m[1] === 'Loss' ? 'L' : 'D',
    opponent: (m[3] || m[2]).trim()
  }));
  console.log('Histórico:', history);
}

async function run() {
  await testCount('Alex Pereira');
  await testCount('Islam Makhachev');
  await testCount('Paddy Pimblett');
}
run().catch(e => console.error(e.message));
