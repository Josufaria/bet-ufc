const axios = require('axios');

async function test() {
  try {
    const r = await axios.get('http://ufcstats.com/statistics/fighters?char=a&page=all', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    console.log(r.data.slice(0, 500));
  } catch (e) {
    console.log(e.message);
  }
}

test();
