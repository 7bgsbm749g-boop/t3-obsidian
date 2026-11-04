import {execFileSync} from 'node:child_process';
import {ESLint} from 'eslint';
import {writeFile} from 'node:fs/promises';
const args=new Set(process.argv.slice(2)),fix=args.has('--fix');
const eslint=new ESLint({fix,cache:false}),results=await eslint.lintFiles(['src/**/*.ts','manifest.json','package.json','LICENSE']);
if(fix)await ESLint.outputFixes(results);
const jsonIndex=process.argv.indexOf('--json');
if(jsonIndex>=0){const path=process.argv[jsonIndex+1];if(!path)throw Error('--json needs an output path');await writeFile(path,JSON.stringify(results,null,2)+'\n');}
else console.log(await (await eslint.loadFormatter('stylish')).format(results));
const errors=results.reduce((total,result)=>total+result.errorCount,0),warnings=results.reduce((total,result)=>total+result.warningCount,0);
console.log(`${errors} errors, ${warnings} warnings`);
process.exitCode=errors||warnings?1:0;
if(!process.exitCode){for(const script of ['scripts/check-platform-boundaries.mjs','scripts/check-review-styles.mjs'])execFileSync(process.execPath,[script],{stdio:'inherit'});}
