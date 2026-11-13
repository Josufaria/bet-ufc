const fs = require('fs');
const file = 'js/fighters-db.js';
let txt = fs.readFileSync(file, 'utf8');

// Adiciona Sharabutdin
txt = txt.replace(/"shara magomedov":/, '"sharabutdin magomedov": { height_cm: 188, reach_cm: 185, weight_class: "Middleweight", stance: "Orthodox", style: "Striker" },\n  "shara magomedov":');

// Adiciona Matheus Camilo
txt = txt.replace(/const FIGHTERS_DB = \{/, 'const FIGHTERS_DB = {\n  "matheus camilo": { height_cm: 178, reach_cm: 175, weight_class: "Lightweight", stance: "Orthodox", style: "Striker" },');

fs.writeFileSync(file, txt, 'utf8');
console.log('Lutadores adicionados com sucesso!');
