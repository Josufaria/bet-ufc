const fs = require('fs');
const path = 'js/fighters-db.js';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('function getCustomFighters')) {
  content += `

// Funcoes restauradas
function getCustomFighters() {
  try {
    const custom = localStorage.getItem('custom_fighters_db');
    return custom ? JSON.parse(custom) : {};
  } catch (e) {
    return {};
  }
}

function saveCustomFighter(name, data) {
  if (!name || !data) return;
  const custom = getCustomFighters();
  custom[name.toLowerCase().trim()] = data;
  localStorage.setItem('custom_fighters_db', JSON.stringify(custom));
}

function getLutStyle(name) {
  return null;
}
`;
  fs.writeFileSync(path, content, 'utf8');
  console.log('Funcoes restauradas!');
} else {
  console.log('Ja estao la');
}
