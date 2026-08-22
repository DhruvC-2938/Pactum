const fs = require('fs');
let html = fs.readFileSync('../frontend-vanilla/index.html', 'utf8');

// Extract just the .app-shell part
const match = html.match(/<div class="app-shell">([\s\S]*?)<\/main>\n<\/div>/);
if (match) {
  html = '<div className="app-shell">' + match[1] + '</main></div>';
}

// Convert class to className
html = html.replace(/class="/g, 'className="');
// Convert for to htmlFor
html = html.replace(/for="/g, 'htmlFor="');
// Close input tags
html = html.replace(/<input([^>]*?[^/])>/g, '<input$1 />');
// Fix inline styles
html = html.replace(/style="([^"]+)"/g, (match, styleStr) => {
  const styles = styleStr.split(';').filter(s => s.trim()).map(s => {
    let [key, val] = s.split(':');
    if (!key || !val) return '';
    key = key.trim().replace(/-([a-z])/g, g => g[1].toUpperCase());
    return `${key}: "${val.trim()}"`;
  });
  return `style={{${styles.join(', ')}}}`;
});
// Remove onclick handlers (we'll fix them or leave them as comments for now)
html = html.replace(/onclick="[^"]*"/g, 'onClick={() => {}}');
// Fix SVG fill rules
html = html.replace(/fill-rule/g, 'fillRule');
html = html.replace(/clip-rule/g, 'clipRule');
html = html.replace(/stroke-width/g, 'strokeWidth');
html = html.replace(/stroke-linecap/g, 'strokeLinecap');
html = html.replace(/stroke-linejoin/g, 'strokeLinejoin');

const appTsx = `
import { useState } from 'react'
import { PullToRefresh } from './components/motion/pull-to-refresh'
import './app.css'

export default function App() {
  const [refreshing, setRefreshing] = useState(false);
  
  return (
    <>
      ${html}
    </>
  )
}
`;
fs.writeFileSync('./src/App.tsx', appTsx);
console.log('Done converting!');
