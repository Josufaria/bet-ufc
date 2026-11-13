const axios = require('axios');
const fs = require('fs');

const CSV_URL = 'https://raw.githubusercontent.com/jasonchanhku/UFC-MMA-Predictor/master/Datasets/UFC_Fighters_Database.csv';
const DB_PATH = './js/fighters-db.js';
const TEMP_PATH = './js/fighters-db.temp.js';

const AVG_HEIGHTS = {
  "Strawweight": 160,
  "Flyweight": 165,
  "Bantamweight": 170,
  "Featherweight": 175,
  "Lightweight": 178,
  "Welterweight": 183,
  "Middleweight": 185,
  "Light Heavyweight": 188,
  "Heavyweight": 191,
  "Catchweight": 175,
  "Unknown": 175
};

async function run() {
  console.log('Baixando CSV de REACH...');
  const { data } = await axios.get(CSV_URL);
  
  let content = fs.readFileSync(DB_PATH, 'utf8');
  
  // Create temp module with ONLY what exists
  let tempContent = content + '\nmodule.exports = { FIGHTERS_DB };';
  fs.writeFileSync(TEMP_PATH, tempContent, 'utf8');
  
  const tempModule = require('.' + TEMP_PATH);
  const FIGHTERS_DB = tempModule.FIGHTERS_DB;

  const lines = data.split('\n');
  const csvData = {};
  
  lines.forEach((line, i) => {
    if (i === 0 || !line) return;
    const cols = line.split(',');
    if (cols.length < 4) return;
    const name = cols[0].toLowerCase().trim();
    const reachInches = parseFloat(cols[3]);
    if (!isNaN(reachInches) && reachInches > 0) {
      csvData[name] = Math.round(reachInches * 2.54);
    }
  });

  let reachUpdated = 0;
  let heightUpdated = 0;

  for (const name in FIGHTERS_DB) {
    const f = FIGHTERS_DB[name];
    
    if (f.reach_cm === 0 && csvData[name]) {
      f.reach_cm = csvData[name];
      reachUpdated++;
    }
    
    if (f.reach_cm === 0) {
      const avgH = AVG_HEIGHTS[f.weight_class] || 175;
      f.reach_cm = avgH; 
      reachUpdated++;
    }

    if (f.height_cm === 0) {
      const avgH = AVG_HEIGHTS[f.weight_class] || 175;
      f.height_cm = avgH;
      heightUpdated++;
    }
  }

  console.log(`Atualizados: ${reachUpdated} envergaduras e ${heightUpdated} alturas.`);

  let newDbStr = "/**\\n * 🥊 BANCO DE DADOS DE LUTADORES UFC (COMPLETO)\\n */\\n\\n";
  newDbStr += "const FIGHTERS_DB = {\\n";
  const keys = Object.keys(FIGHTERS_DB).sort();
  
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = FIGHTERS_DB[k];
    const line = `  "${k}": { height_cm: ${v.height_cm}, reach_cm: ${v.reach_cm}, weight_class: "${v.weight_class || 'Unknown'}", stance: "${v.stance || 'Orthodox'}", style: "${v.style || 'All-Round'}" }${i < keys.length - 1 ? ',' : ''}\\n`;
    newDbStr += line;
  }
  newDbStr += "};\n\n";

  const fnIndex = content.indexOf('function getFighterData');
  const endFunctions = content.substring(fnIndex);
  newDbStr += endFunctions;

  fs.writeFileSync(DB_PATH, newDbStr, 'utf8');
  fs.unlinkSync(TEMP_PATH);
  
  console.log(`Banco de dados salvo em definitivo!`);
}

run();
