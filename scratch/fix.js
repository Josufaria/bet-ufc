const fs = require('fs');

function applyFixes() {
  const appPath = './js/app.js';
  const espnPath = './js/espn.js';
  
  let appJs = fs.readFileSync(appPath, 'utf8');
  let espnJs = fs.readFileSync(espnPath, 'utf8');
  
  // 1. API Key exposed
  appJs = appJs.replace(
    `if (!localStorage.getItem('ufc_sheet_migrated_v5')) {
  localStorage.setItem('ufc_sheet_id', '10YBrQnIKr8x3VG2qzO4jT0TJe5xOedOxQA0TKMc_1PE');
  localStorage.setItem('ufc_api_key', '${process.env.GOOGLE_SHEETS_API_KEY || ''}');
  localStorage.setItem('ufc_sheet_migrated_v5', 'true');
}`, 
    `if (!localStorage.getItem('ufc_sheet_migrated_v5')) {
  localStorage.setItem('ufc_sheet_id', '10YBrQnIKr8x3VG2qzO4jT0TJe5xOedOxQA0TKMc_1PE');
  localStorage.setItem('ufc_sheet_migrated_v5', 'true');
}`
  );

  appJs = appJs.replace(
    `let CFG = {
  SHEET_ID: localStorage.getItem('ufc_sheet_id') || '10YBrQnIKr8x3VG2qzO4jT0TJe5xOedOxQA0TKMc_1PE',
  API_KEY:  localStorage.getItem('ufc_api_key')  || '${process.env.GOOGLE_SHEETS_API_KEY || ''}',
};`,
    `let CFG = {
  SHEET_ID: localStorage.getItem('ufc_sheet_id') || '10YBrQnIKr8x3VG2qzO4jT0TJe5xOedOxQA0TKMc_1PE',
};`
  );

  appJs = appJs.replace(
    /const BASE\s*=\s*\(\)\s*=>\s*`https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/\$\{CFG\.SHEET_ID\}`;/,
    `const BASE = () => \`/api/sheets-proxy\`;`
  );

  appJs = appJs.replace(
    `async function api(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = BASE() + path + sep + 'key=' + CFG.API_KEY;
  const r = await fetch(url);`,
    `async function api(path) {
  const url = \`/api/sheets-proxy?path=\${encodeURIComponent(path)}\`;
  const r = await fetch(url);`
  );

  // 2. loadDemoData() loop
  appJs = appJs.replace(
    `  _tipsters = ["?? PunterMind", "Tipster A"];
  _zebraStats = computeOddsCatsGeral();
  renderAll();
}`,
    `  _tipsters = ["?? PunterMind", "Tipster A"];
  _zebraStats = computeOddsCatsGeral();
}`
  );

  // 3. renderEvento() guarda
  appJs = appJs.replace(
    `function renderEvento() {
  const nome = document.getElementById('evento-sel').value;`,
    `function renderEvento() {
  const sel = document.getElementById('evento-sel');
  if (!sel) return;
  const nome = sel.value;`
  );

  // 4. Charts ocultos
  appJs = appJs.replace(
    `  renderROIChart(stats);
  renderCompareChart(stats);
  renderStyleStats();`, // wait, I don't know if they are exactly adjacent, let's just use replace individually
    `  // renderROIChart(stats);
  // renderCompareChart(stats);
  // renderStyleStats();`
  ); // Wait, looking at the previous grep, they were not adjacent.

  // Let's replace the charts from renderAll correctly:
  appJs = appJs.replace(`  renderROIChart(stats);\n  renderROICompare(stats);`, `  // renderROIChart moved to switchTab\n  renderROICompare(stats);`);
  appJs = appJs.replace(`  renderCompareChart(stats);\n  renderOddsCats();`, `  // renderCompareChart moved to switchTab\n  renderOddsCats();`);
  appJs = appJs.replace(`  renderStyleStats();\n`, `  // renderStyleStats moved to switchTab\n`);
  
  // in switchTab:
  appJs = appJs.replace(
    `  if (btnHistorico) btnHistorico.classList.toggle('active', tabId === 'historico');`,
    `  if (btnHistorico) btnHistorico.classList.toggle('active', tabId === 'historico');
  
  if (tabId === 'historico') {
    const stats = computeStats();
    if (typeof renderROIChart === 'function') renderROIChart(stats);
    if (typeof renderCompareChart === 'function') renderCompareChart(stats);
    if (typeof renderStyleStats === 'function') renderStyleStats();
  }`
  );

  // 5. fHeight shows NaN
  appJs = appJs.replace(
    `const fHeight = (db) => db && db.height_cm ? \`\${(db.height_cm / 100).toFixed(2)}m\` : '-';`,
    `const fHeight = (db) => {
    const h = parseFloat(db?.height_cm);
    return (!db || isNaN(h)) ? '—' : \`\${(h / 100).toFixed(2)}m\`;
  };`
  );
  appJs = appJs.replace(
    `const fReach = (db) => db && db.reach_cm ? \`\${db.reach_cm}cm\` : '-';`,
    `const fReach = (db) => {
    const r = parseFloat(db?.reach_cm);
    return (!db || isNaN(r)) ? '—' : \`\${r}cm\`;
  };`
  );

  // 6. espn.js #espn-container
  espnJs = espnJs.replace(
    `async function fetchEspnData() {
  const container = document.getElementById('espn-container');`,
    `async function fetchEspnData() {
  const container = document.getElementById('espn-container');
  if (!container) return;`
  );

  // 7. hitRate usa '-'
  appJs = appJs.replace(
    `hitRate: pmPicks > 0 ? (pmAcertos / pmPicks * 100).toFixed(1) : '-',`,
    `hitRate: pmPicks > 0 ? (pmAcertos / pmPicks * 100).toFixed(1) : '—',`
  );
  appJs = appJs.replace(
    `const pct = s.hitRate !== '-' ? s.hitRate + '%' : '-';`,
    `const pct = s.hitRate !== '—' ? s.hitRate + '%' : '-';`
  );
  appJs = appJs.replace(
    `\${s.hitRate !== '-' ? s.hitRate + '%' : '-'}`,
    `\${s.hitRate !== '—' ? s.hitRate + '%' : '-'}`
  );

  // 8. Timeout ESPN
  appJs = appJs.replace(
    `const espnRes = await fetch('/api/get-espn-events');`,
    `const espnRes = await Promise.race([
        fetch('/api/get-espn-events'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('ESPN timeout')), 5000))
      ]);`
  );

  // 9. onclick inline to data-attribute
  // Find where onclick is used in buildFightCard or similar. We will just use regex to fix all `.fc-edit-btn` elements
  appJs = appJs.replace(/onclick="openFighterModal\('([^']+)'\)"/g, 'data-fighter="$1"');
  appJs = appJs.replace(/onclick='openFighterModal\(\\"([^']+)\\"\)'/g, 'data-fighter="$1"');
  
  // also inject the event listener
  if (!appJs.includes('document.addEventListener("click"')) {
    appJs += `
// Event listener centralizado para modal de lutador
document.addEventListener('click', e => {
  const btn = e.target.closest('.fc-edit-btn');
  if (btn) openFighterModal(btn.dataset.fighter);
});
`;
  }

  fs.writeFileSync(appPath, appJs);
  fs.writeFileSync(espnPath, espnJs);
  console.log("Fixes applied");
}

applyFixes();
