import {runBackgroundResponseHost} from './response-host-background';
const root=process.argv[process.argv.indexOf('--root')+1];
if(!root||!process.argv.includes('--root'))throw Error('A response host needs its exact vault root.');
void runBackgroundResponseHost(root).catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
