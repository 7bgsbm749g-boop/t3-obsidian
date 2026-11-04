// Build the official scanner rules from an immutable upstream commit. This is
// development tooling only; none of this package enters the plugin bundle.
import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile,readdir,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const commit='2c05f10a347f7a01907cc542738409a3302ed358';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),destination=join(root,'scripts/vendor');
const temporary=await mkdtemp(join(tmpdir(),'t3-review-linter-'));
try{
 const supplied=process.argv[2],archive=supplied?await readFile(resolve(supplied)):Buffer.from(await (await fetch(`https://codeload.github.com/obsidianmd/eslint-plugin/tar.gz/${commit}`)).arrayBuffer());
 const archiveFile=join(temporary,'source.tar.gz');await writeFile(archiveFile,archive);
 execFileSync('tar',['-xzf',archiveFile,'-C',temporary]);
 const source=join(temporary,`eslint-plugin-${commit}`),entryPoints=[];
 async function visit(directory){for(const file of await readdir(directory,{withFileTypes:true})){const path=join(directory,file.name);if(file.isDirectory())await visit(path);else if(file.name.endsWith('.ts'))entryPoints.push(path)}}
 await visit(join(source,'lib'));
 await build({entryPoints,outbase:source,outdir:join(source,'dist'),format:'esm',platform:'node',target:'es2022',logLevel:'warning'});
 const metadata=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
 metadata.t3PinnedSource={repository:'https://github.com/obsidianmd/eslint-plugin',commit,sourceArchiveSha256:createHash('sha256').update(archive).digest('hex'),builder:'scripts/build-review-linter.mjs'};
 await writeFile(join(source,'package.json'),JSON.stringify(metadata,null,2)+'\n');
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json'],{cwd:source,encoding:'utf8'}))[0];
 const filename=`eslint-plugin-obsidianmd-${commit.slice(0,12)}.tgz`;await mkdir(destination,{recursive:true});await writeFile(join(destination,filename),await readFile(join(source,packed.filename)));
 await writeFile(join(destination,'obsidian-linter-source.json'),JSON.stringify({...metadata.t3PinnedSource,packageVersion:metadata.version,archive:filename},null,2)+'\n');
 console.log(filename);
}finally{await rm(temporary,{recursive:true,force:true})}
