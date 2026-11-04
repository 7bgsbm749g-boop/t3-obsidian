import {readFile} from 'node:fs/promises';
const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
for(const pattern of [/:has\s*\(/,/display\s*:\s*contents\b/,/clip-path\s*:/])if(pattern.test(css))throw Error('Unsupported or expensive CSS returned: '+pattern);
const important=css.split('\n').filter(line=>line.includes('!important'));
// The measured floor must outrank CodeMirror's changing inline min-height.
if(important.length!==1||important[0]!=='.cm-content[data-t3-response-height-guard="true"] { min-height: var(--send-to-t3-response-min-height) !important; }')throw Error('An undocumented CSS priority override was added.');
console.log('CSS review checks passed; one required native height override.');
