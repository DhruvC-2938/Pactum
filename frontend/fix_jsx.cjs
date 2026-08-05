const fs = require('fs');
let jsx = fs.readFileSync('./src/App.tsx', 'utf8');

// Convert HTML comments to JSX comments
jsx = jsx.replace(/<!--([\s\S]*?)-->/g, '{/*$1*/}');

fs.writeFileSync('./src/App.tsx', jsx);
console.log('Fixed comments!');
