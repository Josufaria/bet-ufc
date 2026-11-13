const axios = require('axios');
const cheerio = require('cheerio');

async function run() {
  try {
    const r = await axios.get('http://ufcstats.com/statistics/fighters/search?query=Sharabutdin');
    const $ = cheerio.load(r.data);
    const link = $('.b-statistics__table-content a').first().attr('href');
    console.log('Link:', link);
    
    if (link) {
      const r2 = await axios.get(link);
      const $2 = cheerio.load(r2.data);
      const height = $2('.b-list__box-list-item:contains("Height:")').text().replace('Height:', '').trim();
      const reach = $2('.b-list__box-list-item:contains("Reach:")').text().replace('Reach:', '').trim();
      console.log('H:', height, 'R:', reach);
      
      // Parse height like "6' 2"" to cm
      let hCm = 0;
      if (height.includes("'")) {
        const parts = height.split("'");
        const ft = parseInt(parts[0]);
        const inc = parseInt(parts[1].replace('"', '').trim() || '0');
        hCm = Math.round((ft * 12 + inc) * 2.54);
      }
      
      // Parse reach like "73"" to cm
      let rCm = 0;
      if (reach.includes('"')) {
        rCm = Math.round(parseFloat(reach.replace('"', '').trim()) * 2.54);
      }
      
      console.log('H_CM:', hCm, 'R_CM:', rCm);
    }
  } catch(e) {
    console.log('Erro:', e.message);
  }
}
run();
