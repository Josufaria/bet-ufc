const puppeteer = require('puppeteer');
const fs = require('fs');
const vm = require('vm');

const DB_PATH = './js/fighters-db.js';

function parseHeight(htStr) {
  if (!htStr || !htStr.includes("'")) return 0;
  const parts = htStr.replace('"', '').split("'");
  const feet = parseInt(parts[0].trim()) || 0;
  const inches = parseInt(parts[1].trim()) || 0;
  return Math.round((feet * 30.48) + (inches * 2.54));
}

function parseReach(reachStr) {
  if (!reachStr || !reachStr.includes('"')) return 0;
  const val = parseFloat(reachStr.replace('"', '').trim());
  return Math.round(val * 2.54);
}

async function run() {
  console.log('Iniciando Puppeteer para contornar Cloudflare...');
  const browser = await puppeteer.launch({ 
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  let content = fs.readFileSync(DB_PATH, 'utf8');
  const fnIndex = content.indexOf('function getLutStyle');
  let dbPart = content.substring(0, fnIndex);
  dbPart = dbPart.replace('const FIGHTERS_DB =', 'return');
  
  let FIGHTERS_DB = {};
  try {
    const script = new vm.Script(`(function() { ${dbPart} })()`);
    FIGHTERS_DB = script.runInThisContext();
  } catch (e) {
    console.error("Falha ao ler o banco atual:", e);
    process.exit(1);
  }

  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
  let updatedCount = 0;
  let newCount = 0;

  for (const letter of alphabet) {
    console.log(`Baixando lutadores com a letra ${letter.toUpperCase()}...`);
    const url = `http://ufcstats.com/statistics/fighters?char=${letter}&page=all`;
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Esperar se tiver Cloudflare JS challenge
      await page.waitForTimeout(2000);

      const fighters = await page.evaluate(() => {
        const rows = document.querySelectorAll('.b-statistics__table-row');
        const data = [];
        rows.forEach((row, idx) => {
          if (idx === 0) return; 
          const cols = row.querySelectorAll('td');
          if (cols.length < 7) return;
          data.push({
            first: cols[0].innerText.trim(),
            last: cols[1].innerText.trim(),
            ht: cols[3].innerText.trim(),
            reach: cols[5].innerText.trim(),
            stance: cols[6].innerText.trim()
          });
        });
        return data;
      });

      for (const f of fighters) {
        const name = `${f.first} ${f.last}`.toLowerCase().trim();
        if (!name) continue;
        const ht = parseHeight(f.ht);
        const r = parseReach(f.reach);
        const st = f.stance || "Orthodox";

        if (FIGHTERS_DB[name]) {
          let changed = false;
          if (ht > 0 && FIGHTERS_DB[name].height_cm !== ht) { FIGHTERS_DB[name].height_cm = ht; changed = true; }
          if (r > 0 && FIGHTERS_DB[name].reach_cm !== r) { FIGHTERS_DB[name].reach_cm = r; changed = true; }
          if (st && FIGHTERS_DB[name].stance !== st && st !== "") { FIGHTERS_DB[name].stance = st; changed = true; }
          if (changed) updatedCount++;
        } else {
          FIGHTERS_DB[name] = {
            height_cm: ht,
            reach_cm: r,
            weight_class: "Unknown",
            stance: st,
            style: "All-Round"
          };
          newCount++;
        }
      }
    } catch (err) {
      console.log(`Erro na letra ${letter}: ${err.message}`);
    }
  }

  await browser.close();

  console.log(`Finalizado! ${updatedCount} atualizados, ${newCount} novos adicionados.`);
  
  let newDbStr = "/**\\n * 🥊 BANCO DE DADOS DE LUTADORES UFC (COMPLETO)\\n * Atualizado via Puppeteer UFCStats\\n */\\n\\n";
  newDbStr += "const FIGHTERS_DB = {\\n";
  const keys = Object.keys(FIGHTERS_DB).sort();
  
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = FIGHTERS_DB[k];
    const line = `  "${k}": { height_cm: ${v.height_cm}, reach_cm: ${v.reach_cm}, weight_class: "${v.weight_class || 'Unknown'}", stance: "${v.stance || 'Orthodox'}", style: "${v.style || 'All-Round'}" }${i < keys.length - 1 ? ',' : ''}\\n`;
    newDbStr += line;
  }
  newDbStr += "};\n\n";

  const endFunctions = content.substring(fnIndex);
  newDbStr += endFunctions;

  fs.writeFileSync(DB_PATH, newDbStr, 'utf8');
  console.log('Arquivo fighters-db.js salvo com sucesso!');
}

run();
