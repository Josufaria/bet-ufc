const axios = require('axios');

async function testESPN(name) {
  console.log('\n=== ESPN API:', name, '===');
  
  // ESPN MMA athletes search
  const url = `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/athletes?limit=5&name=${encodeURIComponent(name)}`;
  const r = await axios.get(url, { 
    headers: { 'User-Agent': 'Mozilla/5.0' }, 
    timeout: 8000 
  });
  
  const athletes = r.data?.athletes || r.data?.items || [];
  console.log('Resposta:', JSON.stringify(r.data).substring(0, 500));
}

async function testESPN2(name) {
  console.log('\n=== ESPN Search:', name, '===');
  // Alternativa: busca geral da ESPN
  const url = `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&limit=5&type=athlete&sport=mma`;
  const r = await axios.get(url, { 
    headers: { 'User-Agent': 'Mozilla/5.0' }, 
    timeout: 8000 
  });
  console.log('Resposta:', JSON.stringify(r.data).substring(0, 600));
}

async function testWikiParse(name) {
  console.log('\n=== Wiki Parse HTML:', name, '===');
  // Wikipedia parse API retorna HTML renderizado
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name + ' mma fighter')}&utf8=&format=json`;
  const r = await axios.get(searchUrl, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const title = r.data?.query?.search?.[0]?.title;
  if (!title) { console.log('NAO ENCONTRADO'); return; }

  // Parse API - retorna HTML renderizado (apenas a secao da tabela de records)
  const parseUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=sections&format=json`;
  const r2 = await axios.get(parseUrl, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const sections = r2.data?.parse?.sections || [];
  const recordSection = sections.find(s => s.line && s.line.toLowerCase().includes('record'));
  console.log('Secao record:', recordSection ? `${recordSection.line} (index: ${recordSection.index})` : 'NAO ENCONTRADA');
  
  if (recordSection) {
    // Pega apenas a secao de record
    const sectionUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&section=${recordSection.index}&prop=wikitext&format=json`;
    const r3 = await axios.get(sectionUrl, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
    const wikitext = r3.data?.parse?.wikitext?.['*'] || '';
    console.log('Wikitext da secao (200 chars):', wikitext.substring(0, 200));
    
    // Tenta contar wins/losses no wikitext da secao
    const wins  = (wikitext.match(/\|\s*win\b/gi)  || []).length;
    const losses = (wikitext.match(/\|\s*loss\b/gi) || []).length;
    console.log('Contagem:', wins+'V', losses+'D');
  }
}

async function run() {
  try { await testESPN('Islam Makhachev'); } catch(e) { console.log('ESPN erro:', e.message); }
  try { await testESPN2('Islam Makhachev'); } catch(e) { console.log('ESPN2 erro:', e.message); }
  try { await testWikiParse('Islam Makhachev'); } catch(e) { console.log('WikiParse erro:', e.message); }
}
run();
