const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const DB_PATH = './js/fighters-db.js';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fixMissingFighters() {
  console.log('Lendo fighters-db.js...');
  let content = fs.readFileSync(DB_PATH, 'utf8');
  
  const regex = /"([^"]+)":\s*\{\s*height_cm:\s*(\d+),\s*reach_cm:\s*(\d+).*?\}/g;
  let match;
  let missing = [];
  
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    const h = parseInt(match[2]);
    const r = parseInt(match[3]);
    
    if (h === 0 || r === 0) {
      missing.push(name);
    }
  }

  console.log(`Encontrados ${missing.length} lutadores com dados zerados.`);
  if (missing.length === 0) return;

  const BATCH_SIZE = 50;
  let modifiedContent = content;
  let totalUpdated = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    console.log(`Processando lote ${Math.floor(i/BATCH_SIZE)+1} / ${Math.ceil(missing.length/BATCH_SIZE)}...`);

    const prompt = `Você é um especialista do UFC. 
    Preencha a altura (h em cm) e a envergadura (r em cm) reais para os seguintes lutadores do MMA.
    Responda APENAS com um JSON válido, onde a chave é o nome do lutador exato fornecido, e o valor é um objeto com "h" (altura) e "r" (envergadura).
    Nomes: ${JSON.stringify(batch)}
    Se não souber exatamente de algum, faça a sua melhor estimativa com base na categoria, ou busque na web. Nunca responda com 0. Não inclua \`\`\`json no inicio nem no fim, apenas o objeto.`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      
      let text = response.text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const data = JSON.parse(text);
      
      for (const name of Object.keys(data)) {
        const stats = data[name];
        if (stats && stats.h > 0 && stats.r > 0) {
          // Escapar possíveis caracteres especiais no nome
          const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const searchRegex = new RegExp(`("${escapedName}":\\s*\\{\\s*height_cm:)\\s*\\d+(,\\s*reach_cm:)\\s*\\d+`, 'i');
          modifiedContent = modifiedContent.replace(searchRegex, `$1 ${stats.h}$2 ${stats.r}`);
          totalUpdated++;
        }
      }
      
      // Salvar a cada lote para não perder progresso
      fs.writeFileSync(DB_PATH, modifiedContent, 'utf8');
      
    } catch (error) {
      console.error(`Erro no lote ${i}:`, error.message);
    }
    
    // Esperar 4 segundos para evitar Rate Limit da API do Gemini (15 RPM free tier)
    await delay(4200);
  }

  console.log(`Finalizado! ${totalUpdated} lutadores corrigidos e salvos.`);
}

fixMissingFighters();
