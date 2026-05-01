const fs = require('fs');
const path = require('path');

const alertPath = path.join(__dirname, 'src', 'services', 'alertManager.js');
let alertCode = fs.readFileSync(alertPath, 'utf8');

alertCode = alertCode.replace(
  "if (!filePath.startsWith(emailDir)) throw new Error('Path traversal detected');",
  "if (!filePath.startsWith(emailDir + path.sep)) throw new Error('Path traversal detected');"
);

fs.writeFileSync(alertPath, alertCode);

const pwPath = path.join(__dirname, 'src', 'services', 'parquetWriter.js');
let pwCode = fs.readFileSync(pwPath, 'utf8');

// Replace all instances of startsWith(dirPath)
pwCode = pwCode.replace(/if \(!(.+?)\.startsWith\(dirPath\)\) throw new Error\('Path traversal detected'\);/g,
  "if (!$1.startsWith(dirPath + path.sep)) throw new Error('Path traversal detected');"
);

fs.writeFileSync(pwPath, pwCode);
