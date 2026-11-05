import {readFile} from 'node:fs/promises';
const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
for(const pattern of [/:has\s*\(/,/display\s*:\s*contents\b/,/clip-path\s*:/])if(pattern.test(css))throw Error('Unsupported or expensive CSS returned: '+pattern);
if(css.includes('!important'))throw Error('CSS priority overrides are not allowed.');
console.log('CSS review checks passed; no priority overrides.');
