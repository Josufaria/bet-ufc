const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

// Requer que a chave seja definida no ambiente: set GEMINI_API_KEY=sua_chave
const ai = new GoogleGenAI({});

const DB_PATH = path.join(__dirname, '../eventos_futuros.txt');

async function analyzeSentiment(fighterName) {
  try {
    console.log(`Analisando hype para: ${fighterName}...`);
    
    // Prompt para o Gemini analisar o hype do lutador
    const prompt = `Analise o "hype" atual (atenção da mídia e dos fãs) do lutador do UFC "${fighterName}". 
    Responda apenas com um número de -10 a 10, onde:
    -10 = Muito odiado / Desacreditado
    0 = Neutro / Pouco falado
    10 = Muito hypado / Queridinho do público
    Apenas o número, sem texto adicional.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const score = parseInt(response.text.trim());
    return isNaN(score) ? 0 : score;
    
  } catch (error) {
    console.error(`Erro ao analisar hype de ${fighterName}:`, error.message);
    return 0; // fallback neutro
  }
}

async function run() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('Arquivo eventos_futuros.txt não encontrado.');
    return;
  }

  const fileContent = fs.readFileSync(DB_PATH, 'utf-8');
  let data = [];
  try {
    data = JSON.parse(fileContent);
  } catch (e) {
    console.log('Erro ao ler a base de dados JSON.');
    return;
  }

  if (data.length === 0) return;

  const nextEvent = data[0]; // Pega o evento mais recente
  console.log(`Calculando Hype para as lutas de: ${nextEvent.name}`);

  for (let fight of nextEvent.fights) {
    // Apenas analisa se ainda não tem score de hype (para não gastar API a toa)
    if (fight.hypeF1 === undefined) {
      fight.hypeF1 = await analyzeSentiment(fight.f1);
      // Timeout simples para evitar rate limit
      await new Promise(r => setTimeout(r, 2000)); 
    }
    
    if (fight.hypeF2 === undefined) {
      fight.hypeF2 = await analyzeSentiment(fight.f2);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log('✅ Análise de Hype concluída com sucesso!');
}

run();
