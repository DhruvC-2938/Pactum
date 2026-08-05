const fs = require('fs');
let jsx = fs.readFileSync('./src/App.tsx', 'utf8');

// 1. Add activePage state
jsx = jsx.replace('const [refreshing, setRefreshing] = useState(false);', `const [refreshing, setRefreshing] = useState(false);
  const [activePage, setActivePage] = useState('dashboard');`);

// 2. Fix sidebar clicks and active state
const navItems = ['dashboard', 'commitments', 'create', 'attest', 'dispute', 'resolve', 'reputation', 'lookup', 'initialize'];
navItems.forEach(page => {
  // Fix button onClick
  let re = new RegExp(`<button className="nav-item( active)?" id="nav-${page}" onClick=\\{\\(\\) => \\{\\}\\}\\>`, 'g');
  jsx = jsx.replace(re, `<button className={\`nav-item \${activePage === '${page}' ? 'active' : ''}\`} id="nav-${page}" onClick={() => setActivePage('${page}')}>`);
});

// 3. Fix pages active state
navItems.forEach(page => {
  let re = new RegExp(`<section className="page( active)?" id="page-${page}">`, 'g');
  jsx = jsx.replace(re, `<section className={\`page \${activePage === '${page}' ? 'active' : ''}\`} id="page-${page}">`);
});

fs.writeFileSync('./src/App.tsx', jsx);
console.log('Fixed navigation state!');
