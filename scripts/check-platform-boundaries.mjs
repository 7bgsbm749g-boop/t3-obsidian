import {readFile,readdir} from 'node:fs/promises';
import {resolve,dirname,relative,join} from 'node:path';
import {isBuiltin} from 'node:module';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'..'),files=[];
async function walk(directory){for(const file of await readdir(directory,{withFileTypes:true})){const name=join(directory,file.name);if(file.isDirectory())await walk(name);else if(name.endsWith('.ts'))files.push(name)}}
await walk(join(root,'src'));
const known=new Set(files),graph=new Map(),nodeFiles=new Set();
for(const file of files){
 const text=await readFile(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),edges=[];
 for(const declaration of source.statements){
  if(!ts.isImportDeclaration(declaration)&&!ts.isExportDeclaration(declaration)||!declaration.moduleSpecifier||!ts.isStringLiteral(declaration.moduleSpecifier)||declaration.isTypeOnly)continue;
  const clause=declaration.importClause;
  if(clause?.isTypeOnly||clause&&!clause.name&&clause.namedBindings&&ts.isNamedImports(clause.namedBindings)&&clause.namedBindings.elements.every(item=>item.isTypeOnly))continue;
  const name=declaration.moduleSpecifier.text;
  if(isBuiltin(name)){
   if(name==='buffer')throw Error(`${relative(root,file)} must select the browser buffer/ package explicitly`);
   if(!/(?:^|\/)desktop(?:-|\.)|\-desktop\.ts$/.test(relative(root,file))||!text.includes('"isDesktopOnly": true'))throw Error(`${relative(root,file)} has no explicit desktop boundary`);
   nodeFiles.add(file);
  }
  if(name.startsWith('.')){const prefix=resolve(dirname(file),name),target=[prefix,prefix+'.ts',join(prefix,'index.ts')].find(candidate=>known.has(candidate));if(target)edges.push(target)}
 }
 graph.set(file,edges);
}
const visited=new Set();function visit(file){if(visited.has(file))return;visited.add(file);if(nodeFiles.has(file))throw Error(`Portable entry eagerly loads ${relative(root,file)}`);for(const next of graph.get(file)??[])visit(next)}
visit(join(root,'src/app/main.ts'));
console.log(`Platform boundaries: ${visited.size} portable modules; ${nodeFiles.size} lazy desktop adapters; no eager Node imports.`);
