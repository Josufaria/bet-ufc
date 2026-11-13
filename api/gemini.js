const { GoogleGenAI } = require('@google/genai');

module.exports = async function handler(req, res) {
  // Configuração CORS (opcional, mas recomendado)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const prompt = req.body.prompt;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // A chave API deve ser configurada nas Variáveis de Ambiente do Vercel
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY não está configurada no servidor Vercel.' });
    }

    const ai = new GoogleGenAI({ apiKey: apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return res.status(200).json({ result: response.text });
  } catch (error) {
    console.error('Erro na API Gemini:', error);
    return res.status(500).json({ error: 'Erro ao gerar conteúdo: ' + error.message });
  }
}
