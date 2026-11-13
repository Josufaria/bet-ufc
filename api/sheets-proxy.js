export default async function handler(req, res) {
  const key = process.env.GOOGLE_SHEETS_API_KEY;
  const id  = process.env.GOOGLE_SHEET_ID || '10YBrQnIKr8x3VG2qzO4jT0TJe5xOedOxQA0TKMc_1PE';
  const path = req.query.path || '';
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}${path}${sep}key=${key}`;
  
  try {
    const r = await fetch(url);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Proxy fetch failed', message: err.message });
  }
}
