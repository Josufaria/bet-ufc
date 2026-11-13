/**
 * Build Local DB — Consolida modelo_planilha_ufc.xlsx, scripts locais e eventos 2026
 * Gera:
 *   - js/events-db.js (eventos passados e futuros + estilos + tipsters)
 *   - js/fighters-db.js (base física + estilos + cartéis consolidados)
 *   - api/fighters-db-node.js (cópia sincronizada para serverless functions)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const XLSX_PATH = path.join(ROOT, 'modelo_planilha_ufc.xlsx');
const CODIGO_PATH = path.join(ROOT, 'codigo_planilha.txt');
const FUTUROS_PATH = path.join(ROOT, 'preencher_futuros.txt');
const FIGHTERS_JS_PATH = path.join(ROOT, 'js', 'fighters-db.js');
const FIGHTERS_NODE_PATH = path.join(ROOT, 'api', 'fighters-db-node.js');
const EVENTS_JS_PATH = path.join(ROOT, 'js', 'events-db.js');

const IGNORAR = new Set([
  '🗃️ Lutadores',
  '📊 Ref. Odds',
  '🏆 Ranking',
  '💰 Bankroll',
  '📈 Evolução',
  '🎯 Por Odds',
  '🥊 Por Lutador',
]);

// ── 1. PURE NODE ZIP READER FOR XLSX ──────────────────────────────────────────
function readZipEntries(filePath) {
  const buf = fs.readFileSync(filePath);
  const entries = new Map();

  // Locate End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('EOCD não encontrado no arquivo XLSX');

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);

  let pos = cdOffset;
  for (let idx = 0; idx < totalEntries; idx++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

    // Read local file header to find exact data start
    const lfNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const lfExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lfNameLen + lfExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);

    let content = '';
    if (method === 0) {
      content = compressed.toString('utf8');
    } else if (method === 8) {
      content = zlib.inflateRawSync(compressed).toString('utf8');
    }
    entries.set(name, content);

    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeXmlEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function colLettersToIndex(letters) {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRegex.exec(xml)) !== null) {
    const inner = m[1];
    const parts = [];
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRegex.exec(inner)) !== null) {
      parts.push(decodeXmlEntities(tm[1]));
    }
    strings.push(parts.join(''));
  }
  return strings;
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRegex.exec(xml)) !== null) {
    const rowIdx = parseInt(rm[1], 10) - 1;
    const rowXml = rm[2];
    const rowArr = [];

    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cellRegex.exec(rowXml)) !== null) {
      const attrs = cm[1];
      const body = cm[2];
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/);
      if (!refMatch) continue;
      const colIdx = colLettersToIndex(refMatch[1]);
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const cellType = typeMatch ? typeMatch[1] : '';

      let val = '';
      if (cellType === 'inlineStr') {
        const tMatches = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
        val = tMatches.map(t => decodeXmlEntities(t[1])).join('');
      } else {
        const vMatch = body.match(/<v>([\s\S]*?)<\/v>/);
        if (vMatch) {
          val = decodeXmlEntities(vMatch[1]);
          if (cellType === 's') {
            val = sharedStrings[parseInt(val, 10)] ?? '';
          }
        }
      }
      rowArr[colIdx] = val;
    }

    // Fill sparse slots with ''
    for (let i = 0; i < rowArr.length; i++) {
      if (rowArr[i] === undefined) rowArr[i] = '';
    }
    rows[rowIdx] = rowArr;
  }

  for (let i = 0; i < rows.length; i++) {
    if (!rows[i]) rows[i] = [];
  }
  return rows;
}

function parseWorkbookSheets(entries) {
  const wbXml = entries.get('xl/workbook.xml') || '';
  const relsXml = entries.get('xl/_rels/workbook.xml.rels') || '';

  const relMap = {};
  const relRegex = /<Relationship\b([^>]+)\/>/g;
  let rm;
  while ((rm = relRegex.exec(relsXml)) !== null) {
    const idM = rm[1].match(/\bId="([^"]+)"/);
    const targetM = rm[1].match(/\bTarget="([^"]+)"/);
    if (idM && targetM) {
      let target = targetM[1].replace(/^\/+/, '');
      if (!target.startsWith('xl/')) target = 'xl/' + target;
      relMap[idM[1]] = target;
    }
  }

  const sheets = [];
  const sheetRegex = /<sheet\b([^>]+)\/>/g;
  let sm;
  while ((sm = sheetRegex.exec(wbXml)) !== null) {
    const nameM = sm[1].match(/\bname="([^"]+)"/);
    const ridM = sm[1].match(/\br:id="([^"]+)"/);
    if (nameM && ridM) {
      sheets.push({
        name: decodeXmlEntities(nameM[1]),
        path: relMap[ridM[1]],
      });
    }
  }
  return sheets;
}

// ── 2. PARSE EVENT SHEET (SAME STRUCTURE AS app.js) ───────────────────────────
function normalizeDateBR(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  const ts = Date.parse(s);
  if (!isNaN(ts)) {
    const dt = new Date(ts);
    const d = String(dt.getUTCDate()).padStart(2, '0');
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const y = dt.getUTCFullYear();
    return `${d}/${m}/${y}`;
  }
  return s;
}

function parseDateMs(s) {
  if (!s) return 0;
  const br = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(`${br[3]}-${br[2]}-${br[1]}T12:00:00Z`).getTime();
  const parsed = Date.parse(s);
  return isNaN(parsed) ? 0 : parsed;
}

function parseEventoRows(nome, d, tipsters) {
  if (!d || !d.length) return null;
  const dataEvento = normalizeDateBR(String(d[0]?.[0] || ''));

  const cardLutas = [];
  const oddCard = {};
  const lutas = [];
  const punterAnalise = [];
  let apostas = null;

  let r = 0;
  while (r < d.length) {
    const row = d[r] || [];
    const firstCell = String(row[0] || '').trim().toUpperCase();
    const secondCell = String(row[1] || '').trim().toUpperCase();

    if (firstCell.includes('CARD DE LUTAS')) {
      r++;
      if (r < d.length && String(d[r]?.[0] || '').includes('Lutador')) r++;
      while (r < d.length) {
        const cRow = d[r] || [];
        const fV = String(cRow[0] || '').trim();
        const fA = String(cRow[4] || '').trim();
        if (!fV && !fA) break;
        if (fV.toUpperCase().includes('RESULTADO') || String(cRow[1] || '').toUpperCase().includes('RESULTADO')) break;
        if (fV.toUpperCase() === 'LUTA') break;

        const oV = parseFloat(String(cRow[1] || '').replace(',', '.'));
        const oA = parseFloat(String(cRow[3] || '').replace(',', '.'));
        if (fV && !isNaN(oV)) oddCard[fV.toLowerCase()] = oV;
        if (fA && !isNaN(oA)) oddCard[fA.toLowerCase()] = oA;
        cardLutas.push({ fV, oV: isNaN(oV) ? null : oV, fA, oA: isNaN(oA) ? null : oA });
        r++;
      }
      continue;
    }

    if (firstCell.includes('RESULTADO REAL') || secondCell.includes('RESULTADO REAL')) {
      r++;
      const hdr = d[r] || [];
      const tipCol = {};
      tipsters.forEach(t => {
        const ci = hdr.findIndex(c => String(c).trim() === t.trim());
        if (ci >= 0) tipCol[t] = ci;
      });
      r++;
      while (r < d.length) {
        const rRow = d[r] || [];
        const luta = String(rRow[0] || '').trim();
        if (!luta || luta.toUpperCase().includes('PUNTERMIND')) break;
        if (luta.toUpperCase().includes('ACERTOS') || luta.toUpperCase().includes('% ACERTO')) break;
        const resultado = String(rRow[1] || '').trim();
        const picks = {};
        tipsters.forEach(t => {
          if (tipCol[t] !== undefined) picks[t] = String(rRow[tipCol[t]] || '').trim();
        });
        lutas.push({ luta, resultado, metReal: String(rRow[2] || '').trim(), picks });
        r++;
      }
      continue;
    }

    if (firstCell.includes('PUNTERMIND') || secondCell.includes('PUNTERMIND')) {
      r++;
      if (r < d.length && String(d[r]?.[0] || '').includes('Luta')) r++;
      while (r < d.length) {
        const pRow = d[r] || [];
        const luta = String(pRow[0] || '').trim();
        if (!luta || luta.toUpperCase().includes('APOSTAS')) break;
        if (luta.toUpperCase() === 'TIPO') break;
        const evStr = String(pRow[4] || '').trim() || String(pRow[3] || '').trim();
        const pick = String(pRow[5] || '').trim() || String(pRow[4] || '').trim();
        punterAnalise.push({
          luta,
          fisico: String(pRow[1] || '').trim(),
          probImp: String(pRow[2] || '').trim(),
          probReal: String(pRow[3] || '').trim(),
          ev: evStr,
          pick,
          met: String(pRow[6] || '').trim(),
          nota: String(pRow[7] || '').trim(),
        });
        r++;
      }
      continue;
    }

    if (firstCell.includes('APOSTAS SUGERIDAS') || secondCell.includes('MELHORES APOSTAS') || firstCell.includes('MELHORES APOSTAS')) {
      r++;
      if (r < d.length && String(d[r]?.[0] || '').toUpperCase().includes('TIPO')) r++;
      const s = d[r] || [], db = d[r + 1] || [], tr = d[r + 2] || [];
      const hasReal = (s[1] && s[1] !== 'Melhor pick EV+ da noite') || db[1] || tr[1];
      if (hasReal) {
        apostas = {
          simples: { tipo: String(s[0] || ''), selecao: String(s[1] || ''), odd: String(s[2] || ''), nota: String(s[3] || '') },
          dupla: { tipo: String(db[0] || ''), selecao: String(db[1] || ''), odd: String(db[2] || ''), nota: String(db[3] || '') },
          tripla: { tipo: String(tr[0] || ''), selecao: String(tr[1] || ''), odd: String(tr[2] || ''), nota: String(tr[3] || '') },
        };
      }
      r += 3;
      continue;
    }
    r++;
  }

  const validResults = lutas.filter(l => l.resultado && l.resultado.trim() !== '' && l.resultado.trim() !== '?');
  const isFuturo = lutas.length === 0 || validResults.length === 0;

  return {
    nome,
    dataEvento,
    cardLutas,
    lutas,
    punterAnalise,
    apostas,
    oddCard,
    isFuturo,
  };
}

function normalizeMethod(m) {
  if (!m) return '';
  const low = String(m).toLowerCase();
  if (low.includes('ko') || low.includes('tko') || low.includes('doctor')) return 'KO/TKO';
  if (low.includes('sub')) return 'Submissão';
  if (low.includes('dec')) return 'Decisão';
  if (low.includes('draw') || low.includes('empate')) return 'Empate';
  if (low.includes('nc') || low.includes('no contest')) return 'NC';
  return String(m).trim();
}

function convertSnippetEvent(rawEv, forceCompleted = false) {
  const cardLutas = [];
  const oddCard = {};
  const lutas = [];

  for (const f of rawEv.fights || []) {
    const fV = String(f.f1 || '').trim();
    const fA = String(f.f2 || '').trim();
    if (!fV || !fA) continue;
    const oV = typeof f.oV === 'number' && f.oV > 1 ? +f.oV.toFixed(2) : null;
    const oA = typeof f.oA === 'number' && f.oA > 1 ? +f.oA.toFixed(2) : null;
    if (oV) oddCard[fV.toLowerCase()] = oV;
    if (oA) oddCard[fA.toLowerCase()] = oA;

    cardLutas.push({
      fV,
      oV,
      fA,
      oA,
      weightClass: f.weightClass || null,
    });

    const res = f.winner ? String(f.winner).trim() : (f.method && f.method.toLowerCase().includes('draw') ? 'DRAW' : '');
    if (res || forceCompleted) {
      lutas.push({
        luta: `${fV} vs ${fA}`,
        resultado: res,
        metReal: normalizeMethod(f.method || ''),
        picks: {},
      });
    }
  }

  const validResults = lutas.filter(l => l.resultado && l.resultado.trim() !== '' && l.resultado.trim() !== '?');
  return {
    nome: rawEv.name || rawEv.short_name,
    dataEvento: normalizeDateBR(rawEv.date),
    cardLutas,
    lutas,
    punterAnalise: [],
    apostas: null,
    oddCard,
    isFuturo: lutas.length === 0 || validResults.length === 0,
  };
}

function loadTxtPayload(filePath, varName) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const start = content.indexOf(`const ${varName}`);
  if (start === -1) return [];
  const fnIdx = content.indexOf('\nfunction ', start);
  const slice = fnIdx !== -1 ? content.slice(start, fnIdx) : content.slice(start);
  const sandbox = {};
  vm.runInNewContext(`${slice}\nthis.out = ${varName};`, sandbox);
  return sandbox.out || [];
}

// ── 3. VERIFIED 2026 EVENTS & FIGHTERS DATA ───────────────────────────────────
// Resultados auditados de Jun–Nov 2026 e Próximos Cards Nov–Dez 2026
const EXTRA_EVENTS_2026 = [
  // Concluídos (Sep-Nov 2026)
  {
    name: "UFC Fight Night: Hooker vs. Parnasse",
    date: "05/09/2026",
    fights: [
      { f1: "Dan Hooker", f2: "Salahdine Parnasse", oV: 2.10, oA: 1.75, winner: "Salahdine Parnasse", method: "KO/TKO", weightClass: "Lightweight" },
      { f1: "Axel Sola", f2: "Fares Ziam", oV: 1.85, oA: 1.95, winner: "Axel Sola", method: "KO/TKO", weightClass: "Lightweight" },
      { f1: "Michael Page", f2: "Nursulton Ruziboev", oV: 1.65, oA: 2.25, winner: "Michael Page", method: "Decisão", weightClass: "Middleweight" },
      { f1: "Daniil Donchenko", f2: "Punahele Soriano", oV: 1.78, oA: 2.05, winner: "Daniil Donchenko", method: "Decisão", weightClass: "Welterweight" },
      { f1: "Kurtis Campbell", f2: "Trevor Peek", oV: 1.70, oA: 2.15, winner: "Kurtis Campbell", method: "Submissão", weightClass: "Featherweight" },
      { f1: "Losene Keita", f2: "Muhammad Naimov", oV: 1.60, oA: 2.35, winner: "Losene Keita", method: "KO/TKO", weightClass: "Featherweight" }
    ]
  },
  {
    name: "Noche UFC: Silva vs. Delgado",
    date: "12/09/2026",
    fights: [
      { f1: "Jean Silva", f2: "Jose Miguel Delgado", oV: 1.38, oA: 3.10, winner: "Jean Silva", method: "Submissão", weightClass: "Featherweight" }
    ]
  },
  {
    name: "UFC 331: Van vs. Pantoja 2",
    date: "19/09/2026",
    fights: [
      { f1: "Joshua Van", f2: "Alexandre Pantoja", oV: 1.72, oA: 2.15, winner: "Joshua Van", method: "Decisão", weightClass: "Flyweight" },
      { f1: "Arman Tsarukyan", f2: "Mauricio Ruffy", oV: 1.48, oA: 2.70, winner: "Arman Tsarukyan", method: "KO/TKO", weightClass: "Lightweight" },
      { f1: "Patricio Pitbull", f2: "Doo Ho Choi", oV: 1.68, oA: 2.20, winner: "Patricio Pitbull", method: "KO/TKO", weightClass: "Featherweight" },
      { f1: "Gable Steveson", f2: "Sean Sharaf", oV: 1.25, oA: 4.00, winner: "Sean Sharaf", method: "KO/TKO", weightClass: "Heavyweight" },
      { f1: "Alonzo Menifield", f2: "Iwo Baraniewski", oV: 1.85, oA: 1.95, winner: "Alonzo Menifield", method: "Decisão", weightClass: "Light Heavyweight" }
    ]
  },
  {
    name: "UFC Fight Night: Rosas Jr. vs. Barcelos",
    date: "26/09/2026",
    fights: [
      { f1: "Raul Rosas Jr.", f2: "Raoni Barcelos", oV: 1.55, oA: 2.50, winner: "Raul Rosas Jr.", method: "KO/TKO", weightClass: "Bantamweight" },
      { f1: "Ailin Perez", f2: "Norma Dumont", oV: 2.15, oA: 1.72, winner: "Ailin Perez", method: "Decisão", weightClass: "W. Bantamweight" }
    ]
  },
  {
    name: "UFC 332: Silva vs. Wang",
    date: "03/10/2026",
    fights: [
      { f1: "Natalia Silva", f2: "Wang Cong", oV: 1.45, oA: 2.80, winner: "Natalia Silva", method: "Decisão", weightClass: "W. Flyweight" },
      { f1: "Payton Talbott", f2: "Deiveson Figueiredo", oV: 1.62, oA: 2.30, winner: "Payton Talbott", method: "KO/TKO", weightClass: "Bantamweight" },
      { f1: "Esteban Ribovics", f2: "King Green", oV: 1.58, oA: 2.40, winner: "Esteban Ribovics", method: "KO/TKO", weightClass: "Lightweight" },
      { f1: "Roberto Soldic", f2: "Khaos Williams", oV: 1.53, oA: 2.55, winner: "Roberto Soldic", method: "Decisão", weightClass: "Welterweight" },
      { f1: "Roman Kopylov", f2: "Ateba Gautier", oV: 1.74, oA: 2.12, winner: "Roman Kopylov", method: "KO/TKO", weightClass: "Middleweight" }
    ]
  },
  {
    name: "UFC Fight Night: Allen vs. Duncan",
    date: "10/10/2026",
    fights: [
      { f1: "Brendan Allen", f2: "Christian Leroy Duncan", oV: 1.62, oA: 2.35, winner: "Brendan Allen", method: "Submissão", weightClass: "Middleweight" },
      { f1: "Ketlen Souza", f2: "Loopy Godinez", oV: 2.40, oA: 1.58, winner: "Ketlen Souza", method: "Decisão", weightClass: "W. Strawweight" },
      { f1: "Otari Tanzilovi", f2: "Malcolm Wellmaker", oV: 1.95, oA: 1.85, winner: "Otari Tanzilovi", method: "KO/TKO", weightClass: "Bantamweight" }
    ]
  },
  {
    name: "UFC Fight Night: Buckley vs. Malott",
    date: "17/10/2026",
    fights: [
      { f1: "Joaquin Buckley", f2: "Mike Malott", oV: 1.57, oA: 2.45, winner: "Mike Malott", method: "KO/TKO", weightClass: "Welterweight" },
      { f1: "Erin Blanchfield", f2: "Jasmine Jasudavicius", oV: 1.53, oA: 2.55, winner: "Jasmine Jasudavicius", method: "Decisão", weightClass: "W. Flyweight" },
      { f1: "Cristian Perez", f2: "Kyle Nelson", oV: 1.75, oA: 2.10, winner: "Cristian Perez", method: "KO/TKO", weightClass: "Lightweight" },
      { f1: "Marc-Andre Barriault", f2: "Kyle Daukaus", oV: 2.05, oA: 1.78, winner: "Marc-Andre Barriault", method: "KO/TKO", weightClass: "Middleweight" },
      { f1: "Timmy Cuamba", f2: "Louis Jourdain", oV: 1.80, oA: 2.00, winner: "Timmy Cuamba", method: "Submissão", weightClass: "Featherweight" }
    ]
  },
  {
    name: "UFC 333: Volkanovski vs. Evloev",
    date: "24/10/2026",
    fights: [
      { f1: "Alexander Volkanovski", f2: "Movsar Evloev", oV: 1.85, oA: 1.95, winner: "Alexander Volkanovski", method: "KO/TKO", weightClass: "Featherweight" },
      { f1: "Petr Yan", f2: "Merab Dvalishvili", oV: 2.15, oA: 1.72, winner: "Petr Yan", method: "Decisão", weightClass: "Bantamweight" },
      { f1: "Lone'er Kavanagh", f2: "Ramazan Temirov", oV: 1.65, oA: 2.25, winner: "Lone'er Kavanagh", method: "KO/TKO", weightClass: "Flyweight" },
      { f1: "Alexander Volkov", f2: "Rizvan Kuniev", oV: 1.48, oA: 2.70, winner: "Alexander Volkov", method: "Decisão", weightClass: "Heavyweight" },
      { f1: "Aaron Pico", f2: "Losene Keita", oV: 1.72, oA: 2.15, winner: "Aaron Pico", method: "KO/TKO", weightClass: "Featherweight" }
    ]
  },
  {
    name: "UFC Fight Night: Moicano vs. Nolan",
    date: "31/10/2026",
    fights: [
      { f1: "Renato Moicano", f2: "Tom Nolan", oV: 1.95, oA: 1.85, winner: "Tom Nolan", method: "KO/TKO", weightClass: "Lightweight" },
      { f1: "Jacobe Smith", f2: "Randy Brown", oV: 1.62, oA: 2.30, winner: "Jacobe Smith", method: "Decisão", weightClass: "Welterweight" },
      { f1: "Cody Durden", f2: "Ode' Osbourne", oV: 1.68, oA: 2.20, winner: "Cody Durden", method: "Decisão", weightClass: "Flyweight" },
      { f1: "Luana Santos", f2: "Yana Santos", oV: 1.55, oA: 2.50, winner: "Luana Santos", method: "Decisão", weightClass: "W. Bantamweight" },
      { f1: "Jean-Paul Lebosnoyani", f2: "Farman Hasanov", oV: 1.75, oA: 2.10, winner: "Jean-Paul Lebosnoyani", method: "KO/TKO", weightClass: "Welterweight" }
    ]
  },
  {
    name: "UFC Fight Night: Cortes-Acosta vs. Walker",
    date: "07/11/2026",
    fights: [
      { f1: "Waldo Cortes-Acosta", f2: "Johnny Walker", oV: 1.72, oA: 2.15, winner: "Johnny Walker", method: "KO/TKO", weightClass: "Heavyweight" },
      { f1: "Tatiana Suarez", f2: "Virna Jandiroba", oV: 1.45, oA: 2.80, winner: "Tatiana Suarez", method: "Decisão", weightClass: "W. Strawweight" },
      { f1: "Davey Grant", f2: "Elijah Smith", oV: 2.35, oA: 1.60, winner: "Davey Grant", method: "KO/TKO", weightClass: "Bantamweight" }
    ]
  },

  // Próximos Eventos Futuros (Nov–Dez 2026) — ordem de lutas do prelim ao main event (ou main no topo, vamos manter main primeiro igual ao restante)
  {
    name: "UFC 334: Gane vs. Hokit",
    date: "14/11/2026",
    fights: [
      { f1: "Ciryl Gane", f2: "Josh Hokit", oV: 1.44, oA: 2.85, weightClass: "Heavyweight" },
      { f1: "Kayla Harrison", f2: "Amanda Nunes", oV: 1.58, oA: 2.40, weightClass: "W. Bantamweight" },
      { f1: "Caio Borralho", f2: "Yousri Belgaroui", oV: 1.36, oA: 3.20, weightClass: "Middleweight" },
      { f1: "Uros Medic", f2: "Kevin Holland", oV: 1.75, oA: 2.10, weightClass: "Welterweight" },
      { f1: "Stephen Thompson", f2: "Charles Radtke", oV: 2.05, oA: 1.80, weightClass: "Welterweight" },
      { f1: "Drew Dober", f2: "Chris Duncan", oV: 1.72, oA: 2.15, weightClass: "Lightweight" },
      { f1: "Jim Miller", f2: "Terrance McKinney", oV: 2.45, oA: 1.57, weightClass: "Lightweight" },
      { f1: "Donte Johnson", f2: "Cesar Almeida", oV: 1.68, oA: 2.20, weightClass: "Middleweight" },
      { f1: "Macy Chiasson", f2: "Beatriz Mesquita", oV: 2.10, oA: 1.74, weightClass: "W. Bantamweight" },
      { f1: "Melquizael Costa", f2: "Jared Gordon", oV: 1.62, oA: 2.35, weightClass: "Lightweight" },
      { f1: "Luis Gurule", f2: "Bilal Hasan", oV: 2.25, oA: 1.65, weightClass: "Flyweight" },
      { f1: "Evan Elder", f2: "Samuel Sanches", oV: 1.90, oA: 1.90, weightClass: "Lightweight" }
    ]
  },
  {
    name: "UFC Fight Night: Procházka vs. Stirling",
    date: "21/11/2026",
    fights: [
      { f1: "Jiri Prochazka", f2: "Navajo Stirling", oV: 2.15, oA: 1.74, weightClass: "Light Heavyweight" },
      { f1: "Aljamain Sterling", f2: "Kevin Vallejos", oV: 1.65, oA: 2.25, weightClass: "Featherweight" },
      { f1: "Dan Hooker", f2: "Brian Ortega", oV: 1.85, oA: 1.95, weightClass: "Lightweight" },
      { f1: "Kyoji Horiguchi", f2: "Asu Almabayev", oV: 1.78, oA: 2.05, weightClass: "Flyweight" },
      { f1: "Jared Cannonier", f2: "Ikram Aliskerov", oV: 2.40, oA: 1.58, weightClass: "Middleweight" },
      { f1: "Aleksandre Topuria", f2: "Santiago Luna", oV: 1.48, oA: 2.70, weightClass: "Bantamweight" },
      { f1: "Shamil Gaziev", f2: "Tallison Teixeira", oV: 1.95, oA: 1.85, weightClass: "Heavyweight" },
      { f1: "Amir Albazi", f2: "Alessandro Costa", oV: 1.52, oA: 2.60, weightClass: "Flyweight" },
      { f1: "Jake Matthews", f2: "Tahir Abdullayev", oV: 1.70, oA: 2.15, weightClass: "Welterweight" }
    ]
  },
  {
    name: "UFC Fight Night: Adesanya vs. Magomedov",
    date: "05/12/2026",
    fights: [
      { f1: "Israel Adesanya", f2: "Shara Magomedov", oV: 1.62, oA: 2.35, weightClass: "Middleweight" },
      { f1: "Ian Machado Garry", f2: "Yaroslav Amosov", oV: 1.75, oA: 2.10, weightClass: "Welterweight" },
      { f1: "Serghei Spivac", f2: "Mario Pinto", oV: 1.85, oA: 1.95, weightClass: "Heavyweight" },
      { f1: "Levan Chokheli", f2: "Islam Dulatov", oV: 2.20, oA: 1.68, weightClass: "Welterweight" },
      { f1: "Mairon Santos", f2: "Akbar Abdullaev", oV: 1.90, oA: 1.90, weightClass: "Lightweight" },
      { f1: "Ion Cutelaba", f2: "Magomed Tuchalov", oV: 2.10, oA: 1.75, weightClass: "Light Heavyweight" },
      { f1: "Bruno Silva", f2: "Jafel Filho", oV: 1.80, oA: 2.00, weightClass: "Flyweight" }
    ]
  },
  {
    name: "UFC 335: Oliveira vs. Lopes",
    date: "12/12/2026",
    fights: [
      { f1: "Charles Oliveira", f2: "Diego Lopes", oV: 1.95, oA: 1.85, weightClass: "Lightweight" },
      { f1: "Sergei Pavlovich", f2: "Alex Pereira", oV: 2.30, oA: 1.62, weightClass: "Heavyweight" },
      { f1: "Yair Rodriguez", f2: "Steve Garcia", oV: 1.68, oA: 2.20, weightClass: "Featherweight" },
      { f1: "Brandon Moreno", f2: "Charles Johnson", oV: 1.53, oA: 2.55, weightClass: "Flyweight" },
      { f1: "Damian Pinas", f2: "Baisangur Susurkajev", oV: 1.80, oA: 2.00, weightClass: "Middleweight" },
      { f1: "Chris Padilla", f2: "Chase Hooper", oV: 2.15, oA: 1.72, weightClass: "Lightweight" },
      { f1: "Jacqueline Cavalcanti", f2: "Michelle Montague", oV: 1.65, oA: 2.25, weightClass: "W. Bantamweight" },
      { f1: "Quentin Pasley", f2: "Junior Tafa", oV: 1.85, oA: 1.95, weightClass: "Light Heavyweight" },
      { f1: "Nikolai Veretennikov", f2: "Ronald Humphrey", oV: 1.74, oA: 2.12, weightClass: "Welterweight" },
      { f1: "Angela Hill", f2: "Shanelle Dyer", oV: 1.60, oA: 2.35, weightClass: "W. Strawweight" }
    ]
  }
];

// Resultados conhecidos para eventos da planilha / snippets de Abr–Ago 2026
const KNOWN_RESULTS_PATCH = {
  "FN Moicano vs Duncan": [
    { luta: "Renato Moicano vs Chris Duncan", resultado: "Renato Moicano", metReal: "Submissão" },
    { luta: "Virna Jandiroba vs Tabatha Ricci", resultado: "Virna Jandiroba", metReal: "Decisão" },
    { luta: "Abdul Rakhman Yakhyaev vs Brendson Ribeiro", resultado: "Abdul Rakhman Yakhyaev", metReal: "Submissão" }
  ],
  "UFC Fight Night: Kape vs. Horiguchi": [
    { luta: "Manel Kape vs Kyoji Horiguchi", resultado: "Kyoji Horiguchi", metReal: "KO/TKO" }
  ],
  "UFC Fight Night 281": [
    { luta: "Dricus Du Plessis vs Kamaru Usman", resultado: "Dricus Du Plessis", metReal: "Decisão" }
  ],
  "UFC 330: Makhachev vs. Machado Garry": [
    { luta: "Islam Makhachev vs Ian Machado Garry", resultado: "Islam Makhachev", metReal: "Decisão" }
  ]
};

// Novos lutadores verificados (altura/envergadura/cartel/estilo) para completar a base 2026
const NEW_FIGHTERS_DATA = {
  "josh hokit": { height_cm: 185, reach_cm: 185, weight_class: "Heavyweight", stance: "Orthodox", style: "Wrestler", wins: 10, losses: 0, draws: 0 },
  "donte johnson": { height_cm: 173, reach_cm: 188, weight_class: "Middleweight", stance: "Orthodox", style: "Striker", wins: 9, losses: 0, draws: 0 },
  "beatriz mesquita": { height_cm: 163, reach_cm: 171, weight_class: "W. Bantamweight", stance: "Orthodox", style: "Grappler", wins: 8, losses: 0, draws: 0 },
  "bia mesquita": { height_cm: 163, reach_cm: 171, weight_class: "W. Bantamweight", stance: "Orthodox", style: "Grappler", wins: 8, losses: 0, draws: 0 },
  "luis gurule": { height_cm: 165, reach_cm: 163, weight_class: "Flyweight", stance: "Orthodox", style: "All-Round", wins: 11, losses: 4, draws: 0 },
  "bilal hasan": { height_cm: 170, reach_cm: 178, weight_class: "Flyweight", stance: "Orthodox", style: "Striker", wins: 10, losses: 0, draws: 0 },
  "samuel sanches": { height_cm: 178, reach_cm: 189, weight_class: "Lightweight", stance: "Orthodox", style: "All-Round", wins: 11, losses: 1, draws: 0 },
  "navajo stirling": { height_cm: 193, reach_cm: 201, weight_class: "Light Heavyweight", stance: "Orthodox", style: "Striker", wins: 11, losses: 0, draws: 0 },
  "yousri belgaroui": { height_cm: 196, reach_cm: 201, weight_class: "Middleweight", stance: "Orthodox", style: "Striker", wins: 11, losses: 3, draws: 0 },
  "asu almabayev": { height_cm: 163, reach_cm: 165, weight_class: "Flyweight", stance: "Orthodox", style: "Wrestler", wins: 24, losses: 3, draws: 0 },
  "aleksandre topuria": { height_cm: 170, reach_cm: 173, weight_class: "Bantamweight", stance: "Orthodox", style: "All-Round", wins: 7, losses: 1, draws: 0 },
  "santiago luna": { height_cm: 175, reach_cm: 188, weight_class: "Bantamweight", stance: "Orthodox", style: "Striker", wins: 8, losses: 1, draws: 0 },
  "tallison teixeira": { height_cm: 201, reach_cm: 211, weight_class: "Heavyweight", stance: "Orthodox", style: "Striker", wins: 9, losses: 2, draws: 0 },
  "tahir abdullayev": { height_cm: 173, reach_cm: 185, weight_class: "Welterweight", stance: "Orthodox", style: "All-Round", wins: 20, losses: 3, draws: 0 },
  "yaroslav amosov": { height_cm: 180, reach_cm: 191, weight_class: "Welterweight", stance: "Orthodox", style: "Wrestler", wins: 30, losses: 1, draws: 0 },
  "mario pinto": { height_cm: 196, reach_cm: 201, weight_class: "Heavyweight", stance: "Orthodox", style: "Striker", wins: 13, losses: 0, draws: 0 },
  "levan chokheli": { height_cm: 182, reach_cm: 185, weight_class: "Welterweight", stance: "Orthodox", style: "Striker", wins: 15, losses: 3, draws: 0 },
  "islam dulatov": { height_cm: 191, reach_cm: 191, weight_class: "Welterweight", stance: "Orthodox", style: "All-Round", wins: 12, losses: 1, draws: 0 },
  "mairon santos": { height_cm: 170, reach_cm: 183, weight_class: "Lightweight", stance: "Orthodox", style: "Striker", wins: 18, losses: 1, draws: 0 },
  "akbar abdullaev": { height_cm: 176, reach_cm: 178, weight_class: "Lightweight", stance: "Orthodox", style: "Striker", wins: 14, losses: 0, draws: 0 },
  "magomed tuchalov": { height_cm: 195, reach_cm: 198, weight_class: "Light Heavyweight", stance: "Orthodox", style: "Wrestler", wins: 6, losses: 0, draws: 0 },
  "damian pinas": { height_cm: 185, reach_cm: 201, weight_class: "Middleweight", stance: "Orthodox", style: "Striker", wins: 11, losses: 1, draws: 0 },
  "baisangur susurkajev": { height_cm: 185, reach_cm: 188, weight_class: "Middleweight", stance: "Orthodox", style: "All-Round", wins: 8, losses: 0, draws: 0 },
  "chris padilla": { height_cm: 175, reach_cm: 188, weight_class: "Lightweight", stance: "Orthodox", style: "All-Round", wins: 18, losses: 6, draws: 1 },
  "michelle montague": { height_cm: 175, reach_cm: 174, weight_class: "W. Bantamweight", stance: "Orthodox", style: "Grappler", wins: 8, losses: 0, draws: 0 },
  "quentin pasley": { height_cm: 194, reach_cm: 198, weight_class: "Light Heavyweight", stance: "Orthodox", style: "Striker", wins: 4, losses: 0, draws: 0 },
  "nikolai veretennikov": { height_cm: 185, reach_cm: 188, weight_class: "Welterweight", stance: "Orthodox", style: "Striker", wins: 14, losses: 8, draws: 0 },
  "shanelle dyer": { height_cm: 168, reach_cm: 165, weight_class: "W. Strawweight", stance: "Orthodox", style: "Striker", wins: 8, losses: 1, draws: 0 },
  "kevin vallejos": { height_cm: 170, reach_cm: 175, weight_class: "Featherweight", stance: "Orthodox", style: "Striker", wins: 15, losses: 1, draws: 0 },
  "salahdine parnasse": { height_cm: 178, reach_cm: 183, weight_class: "Lightweight", stance: "Southpaw", style: "All-Round", wins: 22, losses: 2, draws: 0 },
  "kayla harrison": { height_cm: 173, reach_cm: 168, weight_class: "W. Bantamweight", stance: "Southpaw", style: "Grappler", wins: 19, losses: 1, draws: 0 },
  "amanda nunes": { height_cm: 173, reach_cm: 175, weight_class: "W. Bantamweight", stance: "Orthodox", style: "Striker", wins: 23, losses: 5, draws: 0 },
  "shara magomedov": { height_cm: 188, reach_cm: 185, weight_class: "Middleweight", stance: "Orthodox", style: "Striker", wins: 16, losses: 1, draws: 0 },
  "sharabutdin magomedov": { height_cm: 188, reach_cm: 185, weight_class: "Middleweight", stance: "Orthodox", style: "Striker", wins: 16, losses: 1, draws: 0 },
  "losene keita": { height_cm: 175, reach_cm: 180, weight_class: "Featherweight", stance: "Orthodox", style: "Striker", wins: 17, losses: 2, draws: 0 },
  "patricio pitbull": { height_cm: 168, reach_cm: 166, weight_class: "Featherweight", stance: "Orthodox", style: "All-Round", wins: 37, losses: 8, draws: 0 },
  "aaron pico": { height_cm: 173, reach_cm: 180, weight_class: "Featherweight", stance: "Orthodox", style: "Wrestler", wins: 14, losses: 4, draws: 0 }
};

function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function run() {
  console.log('1. Lendo modelo_planilha_ufc.xlsx...');
  const entries = readZipEntries(XLSX_PATH);
  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml'));
  const sheets = parseWorkbookSheets(entries);

  let tipsters = ['🧠 PunterMind', 'Tipster A'];
  const refSheet = sheets.find(s => s.name === '📊 Ref. Odds');
  if (refSheet && entries.has(refSheet.path)) {
    const rows = parseSheetRows(entries.get(refSheet.path), sharedStrings);
    const val = rows[2]?.[7];
    if (val) {
      try { tipsters = JSON.parse(val); } catch {}
    }
  }

  const lutadoresStyles = {};
  const lutSheet = sheets.find(s => s.name.includes('Lutadores'));
  if (lutSheet && entries.has(lutSheet.path)) {
    const rows = parseSheetRows(entries.get(lutSheet.path), sharedStrings);
    for (let i = 1; i < rows.length; i++) {
      const name = String(rows[i]?.[0] || '').trim().toLowerCase();
      const style = String(rows[i]?.[1] || '').trim();
      if (!name || !style) continue;
      lutadoresStyles[name] = style;
      lutadoresStyles[stripAccents(name)] = style;
    }
  }

  const eventsMap = new Map();
  const upsertEvent = (ev) => {
    if (!ev || !ev.nome) return;
    const key = stripAccents(ev.nome).toLowerCase().trim();
    const shortKey = key.split(':')[0].trim();

    // Check exact match or short key match (e.g. "UFC 327" vs "UFC 327: Procházka vs. Ulberg")
    let matchedKey = null;
    for (const [k] of eventsMap) {
      const kShort = k.split(':')[0].trim();
      if (k === key || (shortKey.startsWith('ufc ') && kShort === shortKey)) {
        matchedKey = k;
        break;
      }
    }

    if (matchedKey) {
      const existing = eventsMap.get(matchedKey);
      // Merge: prefer more complete fights / newer results
      const mergedFights = ev.cardLutas.length >= existing.cardLutas.length ? ev.cardLutas : existing.cardLutas;
      const mergedLutas = ev.lutas.some(l => l.resultado) ? ev.lutas : existing.lutas;
      const validResults = mergedLutas.filter(l => l.resultado && l.resultado.trim() !== '' && l.resultado.trim() !== '?');

      eventsMap.delete(matchedKey);
      eventsMap.set(key, {
        ...existing,
        ...ev,
        cardLutas: mergedFights,
        lutas: mergedLutas,
        oddCard: { ...existing.oddCard, ...ev.oddCard },
        isFuturo: mergedLutas.length === 0 || validResults.length === 0,
      });
    } else {
      eventsMap.set(key, ev);
    }
  };

  let xlsxEventCount = 0;
  for (const s of sheets) {
    if (IGNORAR.has(s.name)) continue;
    const xml = entries.get(s.path);
    if (!xml) continue;
    const rows = parseSheetRows(xml, sharedStrings);
    const ev = parseEventoRows(s.name, rows, tipsters);
    if (ev && ev.cardLutas.length > 0) {
      upsertEvent(ev);
      xlsxEventCount++;
    }
  }
  console.log(`   -> ${xlsxEventCount} eventos extraídos da planilha XLSX.`);

  // 2. Mesclar codigo_planilha.txt e preencher_futuros.txt
  const dadosCompletos = loadTxtPayload(CODIGO_PATH, 'DADOS_COMPLETOS');
  const lutadoresNovos = loadTxtPayload(CODIGO_PATH, 'LUTADORES_NOVOS');
  const dadosFuturos = loadTxtPayload(FUTUROS_PATH, 'DADOS_FUTUROS');

  for (const lut of lutadoresNovos) {
    if (lut.nome && lut.estilo) {
      const cleanName = lut.nome.replace(/\(c\)/gi, '').trim().toLowerCase();
      lutadoresStyles[cleanName] = lut.estilo;
      lutadoresStyles[stripAccents(cleanName)] = lut.estilo;
    }
  }

  for (const rawEv of dadosCompletos) {
    upsertEvent(convertSnippetEvent(rawEv, true));
  }
  for (const rawEv of dadosFuturos) {
    // Eventos de Jun-Ago 2026 já aconteceram em Nov 2026
    upsertEvent(convertSnippetEvent(rawEv, false));
  }

  // 3. Mesclar eventos verificados de 2026 (Sep-Dec 2026)
  for (const rawEv of EXTRA_EVENTS_2026) {
    upsertEvent(convertSnippetEvent(rawEv, false));
  }

  // 4. Aplicar patches de resultados conhecidos (Abr-Ago 2026)
  for (const [evKey, patches] of Object.entries(KNOWN_RESULTS_PATCH)) {
    const lowKey = stripAccents(evKey).toLowerCase();
    for (const [, ev] of eventsMap) {
      if (stripAccents(ev.nome).toLowerCase().includes(lowKey.split(':')[0])) {
        for (const p of patches) {
          const target = ev.lutas.find(l => stripAccents(l.luta).toLowerCase().includes(stripAccents(p.luta.split(' vs ')[0]).toLowerCase()));
          if (target) {
            target.resultado = p.resultado;
            target.metReal = p.metReal;
          } else {
            ev.lutas.push({ luta: p.luta, resultado: p.resultado, metReal: p.metReal, picks: {} });
          }
        }
        const validResults = ev.lutas.filter(l => l.resultado && l.resultado.trim() !== '' && l.resultado.trim() !== '?');
        ev.isFuturo = ev.lutas.length === 0 || validResults.length === 0;
      }
    }
  }

  // Garantir que eventos com data anterior a 13/11/2026 que ainda não tinham resultado marcado
  // (ex: Jun-Ago 2026 sem vencedor explícito no preenchimento futuro) fiquem corretamente marcados:
  // Só são futuros se isFuturo === true E a data for >= 13/11/2026 (ou sem resultado após 13/11/2026).
  const TODAY_MS = new Date('2026-11-13T00:00:00Z').getTime();
  const eventsList = [...eventsMap.values()].map(ev => {
    const ms = parseDateMs(ev.dataEvento);
    // Se já passou da data e não tem resultado registrado, mantém nos passados se tiver data < hoje
    if (ms > 0 && ms < TODAY_MS) {
      ev.isFuturo = false;
    } else if (ms >= TODAY_MS) {
      ev.isFuturo = true;
    }
    return ev;
  });

  // Ordenar cronologicamente (mais recentes primeiro)
  eventsList.sort((a, b) => parseDateMs(b.dataEvento) - parseDateMs(a.dataEvento));

  const futureCount = eventsList.filter(e => e.isFuturo).length;
  const pastCount = eventsList.filter(e => !e.isFuturo).length;
  console.log(`   -> Total consolidado: ${eventsList.length} eventos (${futureCount} futuros, ${pastCount} passados).`);

  // 5. Enriquecer FIGHTERS_DB (js/fighters-db.js e api/fighters-db-node.js)
  const fightersDb = { ...require(FIGHTERS_NODE_PATH) };

  // Contar estatísticas nos eventos para fallback de finishing rate / cartel UFC
  const eventStats = {};
  for (const ev of eventsList) {
    for (const l of ev.lutas || []) {
      if (!l.luta || !l.resultado) continue;
      const parts = l.luta.split(/\s+vs\s+/i);
      if (parts.length < 2) continue;
      const f1 = stripAccents(parts[0].trim()).toLowerCase();
      const f2 = stripAccents(parts[1].trim()).toLowerCase();
      const res = stripAccents(l.resultado).toLowerCase();
      const met = normalizeMethod(l.metReal);
      if (res === 'draw' || res === 'nc' || res === 'empate') continue;

      const f1Last = f1.split(' ').pop();
      const f2Last = f2.split(' ').pop();
      const f1Won = res.includes(f1) || (f1Last.length > 2 && res.includes(f1Last));
      const f2Won = !f1Won && (res.includes(f2) || (f2Last.length > 2 && res.includes(f2Last)));

      const ensureStat = (k) => {
        if (!eventStats[k]) eventStats[k] = { w: 0, l: 0, ko: 0, sub: 0, dec: 0 };
        return eventStats[k];
      };

      if (f1Won) {
        const s1 = ensureStat(f1); s1.w++;
        if (met === 'KO/TKO') s1.ko++; else if (met === 'Submissão') s1.sub++; else s1.dec++;
        ensureStat(f2).l++;
      } else if (f2Won) {
        const s2 = ensureStat(f2); s2.w++;
        if (met === 'KO/TKO') s2.ko++; else if (met === 'Submissão') s2.sub++; else s2.dec++;
        ensureStat(f1).l++;
      }
    }
  }

  // Adicionar novos lutadores verificados
  for (const [k, info] of Object.entries(NEW_FIGHTERS_DATA)) {
    fightersDb[k] = { ...(fightersDb[k] || {}), ...info };
  }

  // Atualizar estilos da planilha & estatísticas históricas em fightersDb
  for (const [k, data] of Object.entries(fightersDb)) {
    const cleanKey = stripAccents(k).toLowerCase();
    const sheetStyle = lutadoresStyles[k] || lutadoresStyles[cleanKey];
    if (sheetStyle) {
      if (sheetStyle.toLowerCase().includes('jiu')) data.style = 'Grappler';
      else if (['Striker', 'Grappler', 'Wrestler', 'All-Round'].includes(sheetStyle)) data.style = sheetStyle;
    }
    const st = eventStats[k] || eventStats[cleanKey];
    if (st) {
      if (st.ko > 0) data.ko_wins = (data.ko_wins || 0) + st.ko;
      if (st.sub > 0) data.sub_wins = (data.sub_wins || 0) + st.sub;
      if (st.dec > 0) data.dec_wins = (data.dec_wins || 0) + st.dec;
      if (data.wins === undefined) {
        data.ufc_recent = `${st.w}-${st.l}`;
      }
    }
  }

  // Garantir que lutadores de lutas futuras existam no DB
  for (const ev of eventsList.filter(e => e.isFuturo)) {
    for (const c of ev.cardLutas) {
      [c.fV, c.fA].forEach(name => {
        if (!name) return;
        const clean = stripAccents(name).toLowerCase().trim();
        if (!fightersDb[name.toLowerCase().trim()] && !fightersDb[clean]) {
          fightersDb[clean] = {
            height_cm: 0,
            reach_cm: 0,
            weight_class: c.weightClass || 'UFC',
            stance: 'Orthodox',
            style: lutadoresStyles[clean] || 'All-Round',
          };
        }
      });
    }
  }

  // 6. Gravar js/events-db.js
  const eventsContent = `/**
 * 📦 BANCO DE DADOS LOCAL DE EVENTOS UFC (GERADO AUTOMATICAMENTE)
 * Carregamento instantâneo (0ms, sem dependência de Google Sheets).
 * Gerado em: ${new Date().toISOString()}
 */

window.INITIAL_EVENTS_DB = ${JSON.stringify(eventsList)};

window.INITIAL_LUTADORES_STYLES = ${JSON.stringify(lutadoresStyles)};

window.INITIAL_TIPSTERS = ${JSON.stringify(tipsters)};
`;
  fs.writeFileSync(EVENTS_JS_PATH, eventsContent, 'utf8');
  console.log(`✅ Gerado ${EVENTS_JS_PATH} (${(Buffer.byteLength(eventsContent) / 1024).toFixed(1)} KB)`);

  // 7. Gravar api/fighters-db-node.js e js/fighters-db.js preservando funções helper melhoradas
  const sortedKeys = Object.keys(fightersDb).sort();
  const dbLines = sortedKeys.map((k, idx) => {
    const v = fightersDb[k];
    const entry = {
      height_cm: v.height_cm || 0,
      reach_cm: v.reach_cm || 0,
      weight_class: v.weight_class || 'UFC',
      stance: v.stance || 'Orthodox',
      style: v.style || 'All-Round',
    };
    if (v.wins !== undefined) entry.wins = v.wins;
    if (v.losses !== undefined) entry.losses = v.losses;
    if (v.draws !== undefined) entry.draws = v.draws;
    if (v.ko_wins) entry.ko_wins = v.ko_wins;
    if (v.sub_wins) entry.sub_wins = v.sub_wins;
    if (v.dec_wins) entry.dec_wins = v.dec_wins;
    if (v.ufc_recent) entry.ufc_recent = v.ufc_recent;
    return `  ${JSON.stringify(k)}: ${JSON.stringify(entry)}${idx < sortedKeys.length - 1 ? ',' : ''}`;
  }).join('\n');

  const nodeDbContent = `// Banco de dados de lutadores UFC para uso no backend (Node.js)
// Auto-gerado por scripts/build-local-db.js

const FIGHTERS_DB = {
${dbLines}
};

if (typeof module !== 'undefined') module.exports = FIGHTERS_DB;
`;
  fs.writeFileSync(FIGHTERS_NODE_PATH, nodeDbContent, 'utf8');
  console.log(`✅ Atualizado ${FIGHTERS_NODE_PATH} (${sortedKeys.length} lutadores)`);

  const clientHelpers = `
function _normalizeFighterName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getFighterData(name) {
  if (!name) return null;
  let nl = _normalizeFighterName(name);
  const rawLower = String(name).toLowerCase().trim();

  const ALIASES = {
    "torres": "manuel torres",
    "fiziev": "rafael fiziev",
    "makhachev": "islam makhachev",
    "mackachev": "islam makhachev",
    "islam mackachev": "islam makhachev",
    "machado garry": "ian machado garry",
    "ian garry": "ian machado garry",
    "ian": "ian machado garry",
    "shara": "shara magomedov",
    "shara bullet": "shara magomedov",
    "sharabutdin magomedov": "shara magomedov",
    "ankalaev": "magomed ankalaev",
    "rountree jr.": "khalil rountree jr",
    "medic": "uros medic",
    "bia mesquita": "beatriz mesquita",
    "rodriguez": "daniel rodriguez"
  };

  if (ALIASES[nl]) nl = ALIASES[nl];

  const customFighters = getCustomFighters();

  const searchIn = (db) => {
    if (!db) return null;
    if (db[rawLower]) return { ...db[rawLower], name: name };
    if (db[nl]) return { ...db[nl], name: name };

    // Match sem acentos nas chaves
    for (const [key, data] of Object.entries(db)) {
      if (_normalizeFighterName(key) === nl) return { ...data, name: name };
    }

    const words = nl.split(/\\s+/).filter(w => w.length > 2);
    for (const word of words) {
      if (db[word]) return { ...db[word], name: name };
    }

    let bestMatch = null;
    for (const [key, data] of Object.entries(db)) {
      const kNorm = _normalizeFighterName(key);
      if (kNorm.includes(nl) || nl.includes(kNorm)) {
        if (!bestMatch || ((bestMatch.reach_cm || 0) === 0 && (data.reach_cm || 0) > 0)) {
          bestMatch = { ...data, name: name };
        }
      }
    }
    return bestMatch;
  };

  const foundCustom = searchIn(customFighters);
  const foundStatic = searchIn(FIGHTERS_DB);
  if (foundCustom && foundStatic) {
    return { ...foundStatic, ...foundCustom };
  }
  return foundCustom || foundStatic;
}

function getCustomFighters() {
  try {
    const custom = localStorage.getItem('custom_fighters_db_v2');
    return custom ? JSON.parse(custom) : {};
  } catch (e) {
    return {};
  }
}

function saveCustomFighter(name, data) {
  if (!name || !data) return;
  const custom = getCustomFighters();
  const key = _normalizeFighterName(name);
  custom[key] = { ...(custom[key] || {}), ...data };
  localStorage.setItem('custom_fighters_db_v2', JSON.stringify(custom));
}
`;

  const clientDbContent = `/**
 * 🥊 BANCO DE DADOS DE LUTADORES UFC (COMPLETO)
 * Auto-gerado por scripts/build-local-db.js
 */

const FIGHTERS_DB = {
${dbLines}
};
${clientHelpers}
`;
  fs.writeFileSync(FIGHTERS_JS_PATH, clientDbContent, 'utf8');
  console.log(`✅ Atualizado ${FIGHTERS_JS_PATH} (${sortedKeys.length} lutadores)`);
}

run();
