const axios = require('axios');

async function testSumRecord(name) {
  console.log('\n=== Sum Record:', name, '===');
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name + ' mma fighter')}&utf8=&format=json`;
  const r = await axios.get(searchUrl, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const title = r.data?.query?.search?.[0]?.title;
  if (!title) { console.log('NAO ENCONTRADO'); return; }

  const url2 = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(title)}&format=json`;
  const r2 = await axios.get(url2, { headers: { 'User-Agent': 'UFCBetStats/1.0' }, timeout: 8000 });
  const pages = r2.data?.query?.pages;
  const rev = pages[Object.keys(pages)[0]].revisions?.[0];
  const content = rev.slots ? rev.slots.main['*'] : rev['*'];

  let wins = null, losses = null, draws = 0, nc = 0;
  let ko_wins = null, sub_wins = null, dec_wins = null;

  // Tenta extrair pelo MMArecordbox (soma dos métodos)
  const koW  = content.match(/\|\s*ko-wins\s*=\s*(\d+)/i);
  const subW = content.match(/\|\s*sub-wins\s*=\s*(\d+)/i);
  const decW = content.match(/\|\s*dec-wins\s*=\s*(\d+)/i);
  const dqW  = content.match(/\|\s*dq-wins\s*=\s*(\d+)/i);
  const othW = content.match(/\|\s*other-wins\s*=\s*(\d+)/i);

  const koL  = content.match(/\|\s*ko-losses\s*=\s*(\d+)/i);
  const subL = content.match(/\|\s*sub-losses\s*=\s*(\d+)/i);
  const decL = content.match(/\|\s*dec-losses\s*=\s*(\d+)/i);
  const dqL  = content.match(/\|\s*dq-losses\s*=\s*(\d+)/i);
  const othL = content.match(/\|\s*other-losses\s*=\s*(\d+)/i);

  if (koW || subW || decW) {
    ko_wins = parseInt(koW?.[1] || 0);
    sub_wins = parseInt(subW?.[1] || 0);
    dec_wins = parseInt(decW?.[1] || 0);
    wins = ko_wins + sub_wins + dec_wins + parseInt(dqW?.[1] || 0) + parseInt(othW?.[1] || 0);
    losses = parseInt(koL?.[1] || 0) + parseInt(subL?.[1] || 0) + parseInt(decL?.[1] || 0) + parseInt(dqL?.[1] || 0) + parseInt(othL?.[1] || 0);
    
    const dM = content.match(/\|\s*draws\s*=\s*(\d+)/i);
    const ncM = content.match(/\|\s*nc\s*=\s*(\d+)/i);
    draws = parseInt(dM?.[1] || 0);
    nc = parseInt(ncM?.[1] || 0);
    console.log(`[MMArecordbox] ${wins}V-${losses}D-${draws}E (KO:${ko_wins} Sub:${sub_wins} Dec:${dec_wins})`);
  } else {
    // Fallback original
    const wM  = content.match(/\|\s*wins\s*=\s*(\d+)/i);
    const lM  = content.match(/\|\s*losses\s*=\s*(\d+)/i);
    if (wM && lM) {
        wins = parseInt(wM[1]);
        losses = parseInt(lM[1]);
        console.log(`[Fallback] ${wins}V-${losses}D`);
    } else {
        console.log('Sem dados de cartel.');
    }
  }
}

async function run() {
  await testSumRecord('Islam Makhachev');
  await testSumRecord('Jon Jones');
  await testSumRecord('Alex Pereira');
  await testSumRecord('Paddy Pimblett');
}
run();
