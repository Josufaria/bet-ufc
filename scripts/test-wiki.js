const axios = require('axios');
async function run() {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent('Sharabutdin Magomedov mma')}&utf8=&format=json`;
    const r = await axios.get(url, { headers: { 'User-Agent': 'UFCBetStats/1.0' } });
    if (r.data.query && r.data.query.search.length > 0) {
      const title = r.data.query.search[0].title;
      console.log('Found title:', title);
      const url2 = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&titles=${encodeURIComponent(title)}&format=json`;
      const r2 = await axios.get(url2, { headers: { 'User-Agent': 'UFCBetStats/1.0' } });
      const pages = r2.data.query.pages;
      const pageId = Object.keys(pages)[0];
      const content = pages[pageId].revisions[0]['*'];
      
      const heightMatch = content.match(/height\s*=\s*(.*?)\n/);
      const reachMatch = content.match(/reach\s*=\s*(.*?)\n/);
      console.log('Height:', heightMatch ? heightMatch[1] : null);
      console.log('Reach:', reachMatch ? reachMatch[1] : null);
    } else {
      console.log('Not found');
    }
  } catch(e) {
    console.log(e.message);
  }
}
run();
