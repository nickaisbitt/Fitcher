const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');

const babelCode = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)[1];

try {
  require('@babel/core').transformSync(babelCode, {
    presets: ['@babel/preset-react', '@babel/preset-env'],
    filename: 'index.js'
  });
  console.log('Syntax check passed!');
} catch (e) {
  console.error(e.message);
}
