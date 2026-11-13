const axios = require('axios');

async function testCartel(name) {
  console.log('\n=== Cartel:', name, '===');
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name + ' mma fighter')}&utf8=&format=json`;
  const r = await axios.get(url, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const title = r.data?.query?.search?.[0]?.title;
  if (!title) { console.log('NAO ENCONTRADO'); return; }

  const url2 = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(title)}&format=json`;
  const r2 = await axios.get(url2, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const pages = r2.data?.query?.pages;
  const pageId = Object.keys(pages)[0];
  const rev = pages[pageId].revisions?.[0];
  const content = rev.slots ? rev.slots.main['*'] : rev['*'];

  // Testa varios padroes de cartel
  const pats = [
    /\|\s*wins\s*=\s*(\d+)/i,
    /\|\s*total_wins\s*=\s*(\d+)/i,
    /record\s*=\s*(\d+)[-–](\d+)/i,
    /(\d+)[-–](\d+)[-–](\d+)\s*(?:NC|nc)?/,
    /\{\{MMA record[^}]*wins\s*=\s*(\d+)/i,
    /wins_\d+\s*=\s*(\d+)/i,
  ];

  for (const p of pats) {
    const m = content.match(p);
    if (m) {
      console.log('Cartel com', p.toString().substring(0,40)+':', m[0].substring(0,50));
    }
  }

  // Mostra trecho onde pode estar o cartel
  const idx = content.search(/\d+\s*[-–]\s*\d+\s*[-–]\s*\d+/);
  if (idx > -1) console.log('Record como W-L-D:', content.substring(Math.max(0,idx-30), idx+50));
  
  // Mostra contexto de 'record'
  const rm = content.match(/record[^=\n]{0,5}=[^\n]{0,60}/i);
  if (rm) console.log('Campo record:', rm[0]);
}

async function run() {
  await testCartel('Jon Jones');
  await testCartel('Islam Makhachev');
}
run().catch(e => console.error(e.message));
