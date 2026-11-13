const axios = require('axios');

async function testSummary(name) {
  console.log('\n=== Summary API:', name, '===');
  
  // Primeiro busca o titulo correto
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name + ' mma fighter')}&utf8=&format=json`;
  const r = await axios.get(searchUrl, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const title = r.data?.query?.search?.[0]?.title;
  if (!title) { console.log('NAO ENCONTRADO'); return; }
  console.log('Titulo:', title);

  // Summary API - retorna texto limpo da introducao
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const r2 = await axios.get(summaryUrl, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const extract = r2.data?.extract || '';
  console.log('Resumo (primeiros 300 chars):', extract.substring(0, 300));
  
  // Testa extracao do cartel do texto
  // Formatos: 27-1, 27–1–0, 22–2 (1 NC), etc.
  const recordMatch = extract.match(/(\d{1,2})[–\-](\d{1,2})(?:[–\-](\d))?(?:\s*\((\d)\s*(?:NC|no contest)\))?/i);
  if (recordMatch) {
    console.log('Cartel encontrado:', recordMatch[1]+'V -', recordMatch[2]+'D');
  } else {
    console.log('Cartel NAO encontrado no resumo');
  }
}

async function run() {
  await testSummary('Jon Jones');
  await testSummary('Islam Makhachev');
  await testSummary('Alex Pereira');
  await testSummary('Sean OMalley');
  await testSummary('Alexandre Pantoja');
}
run().catch(e => console.error(e.message));
