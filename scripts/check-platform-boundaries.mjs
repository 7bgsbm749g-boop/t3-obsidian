import {readFile,readdir} from 'node:fs/promises';
import {resolve,dirname,relative,join} from 'node:path';
import {isBuiltin} from 'node:module';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'..'),files=[];
async function walk(directory){for(const file of await readdir(directory,{withFileTypes:true})){const name=join(directory,file.name);if(file.isDirectory())await walk(name);else if(name.endsWith('.ts'))files.push(name)}}
await walk(join(root,'src'));
const known=new Set(files),graph=new Map(),nodeFiles=new Set();
for(const file of files){
 const text=await readFile(file,'utf8');
 if(/eslint[^\n]*obsidianmd\/no-nodejs-modules/.test(text))throw Error(`Unsupported inline desktop-rule options in ${relative(root,file)}`);
 const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),edges=[];
 function check(node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='require')throw Error(`Use ES imports in ${relative(root,file)}`);ts.forEachChild(node,check)}
 check(source);
 for(const declaration of source.statements){
  if(!ts.isImportDeclaration(declaration)&&!ts.isExportDeclaration(declaration)||!declaration.moduleSpecifier||!ts.isStringLiteral(declaration.moduleSpecifier)||declaration.isTypeOnly)continue;
  const clause=declaration.importClause;
  if(clause?.isTypeOnly||clause&&!clause.name&&clause.namedBindings&&ts.isNamedImports(clause.namedBindings)&&clause.namedBindings.elements.every(item=>item.isTypeOnly))continue;
  const name=declaration.moduleSpecifier.text;
  if(isBuiltin(name)){
   if(name==='buffer')throw Error(`${relative(root,file)} must select the browser buffer/ package explicitly`);
   throw Error(`${relative(root,file)} eagerly imports Node; use a guarded dynamic import instead`);
  }
  if(name.startsWith('.')){const prefix=resolve(dirname(file),name),target=[prefix,prefix+'.ts',join(prefix,'index.ts')].find(candidate=>known.has(candidate));if(target)edges.push(target)}
 }
 graph.set(file,edges);
}
const visited=new Set();function visit(file){if(visited.has(file))return;visited.add(file);if(nodeFiles.has(file))throw Error(`Portable entry eagerly loads ${relative(root,file)}`);for(const next of graph.get(file)??[])visit(next)}
visit(join(root,'src/app/main.ts'));
console.log(`Platform boundaries: ${visited.size} portable modules; all Node imports deferred and no require-style source imports.`);
