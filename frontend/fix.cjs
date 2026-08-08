const fs = require('fs');

// Fix App.tsx
const appPath = './src/App.tsx';
let appContent = fs.readFileSync(appPath, 'utf8');
appContent = appContent.replace(/autocomplete=/g, 'autoComplete=');
appContent = appContent.replace(/spellcheck=/g, 'spellCheck=');
fs.writeFileSync(appPath, appContent);

// Fix pull-to-refresh.tsx
const ptrPath = './src/components/motion/pull-to-refresh.tsx';
let ptrContent = fs.readFileSync(ptrPath, 'utf8');
ptrContent = ptrContent.replace(/transition=\{refreshing \? \(reduce \? CALM_PULSE : CHARACTER_LOOP\) : SPRING_SWAP\}/g, 'transition={refreshing ? (reduce ? CALM_PULSE : CHARACTER_LOOP) : SPRING_SWAP as any}');
ptrContent = ptrContent.replace(/transition=\{SPRING_SWAP\}/g, 'transition={SPRING_SWAP as any}');
ptrContent = ptrContent.replace(/transition=\{LABEL_SWAP\}/g, 'transition={LABEL_SWAP as any}');
ptrContent = ptrContent.replace(/CHARACTER_LOOP = \{/g, 'CHARACTER_LOOP: any = {');
ptrContent = ptrContent.replace(/CALM_PULSE = \{/g, 'CALM_PULSE: any = {');
ptrContent = ptrContent.replace(/SPRING_SWAP = \{/g, 'SPRING_SWAP: any = {');
ptrContent = ptrContent.replace(/LABEL_SWAP = \{/g, 'LABEL_SWAP: any = {');
// For useTransform, error: Type 'number' has no properties in common with type 'ObjectTarget<MotionValue<number>>'
ptrContent = ptrContent.replace(/y: yOffset/g, 'y: yOffset as any');
fs.writeFileSync(ptrPath, ptrContent);

console.log('Fixed TS errors');
