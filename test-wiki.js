const axios = require('axios');

async function testWiki(name) {
  console.log('\n=== Testando:', name, '===');
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name + ' mma fighter')}&utf8=&format=json`;
  const r = await axios.get(url, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  
  if (!r.data?.query?.search?.length) { console.log('Nao encontrado'); return; }
  
  const title = r.data.query.search[0].title;
  console.log('Titulo:', title);
  
  const url2 = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(title)}&format=json`;
  const r2 = await axios.get(url2, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const pages = r2.data?.query?.pages;
  const pageId = Object.keys(pages)[0];
  const rev = pages[pageId].revisions?.[0];
  const content = rev.slots ? rev.slots.main['*'] : rev['*'];
  
  // Teste todos os padroes de data
  const patterns = [
    /birth.?date[^=\n]*=\s*\{\{[^}]*?(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i,
    /birth.?date\s*=\s*(\d{4})-(\d{1,2})-(\d{1,2})/,
    /\{\{birth[_ ]date[^}]*?\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i,
    /\{\{bda\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i,
    /born.*?(\d{4})-(\d{1,2})-(\d{1,2})/is,
  ];
  
  let found = false;
  for (const p of patterns) {
    const m = content.match(p);
    if (m) {
      console.log('Data encontrada com padrao', p.toString().substring(0,50)+':', m[0].substring(0,60));
      const d = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
      const now = new Date();
      let age = now.getFullYear() - d.getFullYear();
      const mo = now.getMonth() - d.getMonth();
      if (mo < 0 || (mo===0 && now.getDate() < d.getDate())) age--;
      console.log('Idade calculada:', age);
      found = true;
      break;
    }
  }
  if (!found) {
    // Mostra contexto de birth_date bruto
    const bm = content.match(/birth[^=]{0,10}=([^\n]{0,80})/i);
    console.log('birth_date bruto:', bm ? bm[0] : 'NAO ENCONTRADO');
  }
  
  // Cartel
  const wm = content.match(/\|\s*wins\s*=\s*(\d+)/i);
  const lm = content.match(/\|\s*losses\s*=\s*(\d+)/i);
  console.log('Cartel:', wm ? wm[1]+'V' : '?', '-', lm ? lm[1]+'D' : '?');
}

async function run() {
  await testWiki('Jon Jones');
  await testWiki('Islam Makhachev');
  await testWiki('Alex Pereira');
  await testWiki('Paddy Pimblett');
  await testWiki('Conor McGregor');
}
run().catch(e => console.error(e.message));
