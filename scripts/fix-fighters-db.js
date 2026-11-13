const fs = require('fs');

let content = fs.readFileSync('js/fighters-db.js', 'utf8');

// The block that was accidentally deleted
const missingBlock = `  const customFighters = getCustomFighters();

  // Função interna de busca em uma tabela específica
  const searchIn = (db) => {
    // Match exato
    if (db[nl]) return { ...db[nl], name: name };

    // Match por sobrenome ou apelido
    const words = nl.split(/\\s+/).filter(w => w.length > 2);
    let bestMatch = null;

    for (const word of words) {
      if (db[word]) return { ...db[word], name: name };
    }

    // Match parcial (Busca o lutador com dados mais completos)
    for (const [key, data] of Object.entries(db)) {
      if (key.includes(nl) || nl.includes(key)) {
        if (!bestMatch || (bestMatch.reach_cm === 0 && data.reach_cm > 0)) {
           bestMatch = { ...data, name: name };
        }
      }
      
      const keyWords = key.split(/\\s+/);
      if (words.some(w => keyWords.includes(w))) {
         if (!bestMatch || (bestMatch.reach_cm === 0 && data.reach_cm > 0)) {
           bestMatch = { ...data, name: name };
         }
      }
    }`;

// Replace the placeholder where the replace_file_content failed (it left nothing, so we inject after ALIASES)
const anchor = '    nl = ALIASES[nl];\n  }';
if (content.includes(anchor)) {
    // Check if the missing block is actually missing, or just partially there
    if (!content.includes('const customFighters = getCustomFighters();')) {
        content = content.replace(anchor, anchor + '\n\n' + missingBlock);
    } else {
        // Just fix the regexes if the block is there
        content = content.replace(/nl\.split\(\/\\\\s\+\/\)/g, 'nl.split(/\\s+/)');
        content = content.replace(/key\.split\(\/\\\\s\+\/\)/g, 'key.split(/\\s+/)');
    }
}

// Remove getLutStyle stub
content = content.replace(/function getLutStyle\(name\) \{\s*return null;\s*\}/g, '');

fs.writeFileSync('js/fighters-db.js', content, 'utf8');
