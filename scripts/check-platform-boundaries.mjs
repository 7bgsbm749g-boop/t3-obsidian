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
 function check(node){
  const where=relative(root,file);
  if(ts.isCallExpression(node)){
   if(ts.isIdentifier(node.expression)&&node.expression.text==='require')throw Error(`Use ES imports in ${where}`);
   if(node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0])&&/^(?:node:)?(?:fs(?:\/promises)?|child_process|http|https|net|tls)$/.test(node.arguments[0].text))throw Error(`Retired native file/process/server capability in ${where}`);
   if(ts.isPropertyAccessExpression(node.expression)&&['getFiles','getMarkdownFiles','getAllLoadedFiles'].includes(node.expression.name.text))throw Error(`Vault enumeration is retired: ${where}`);
  }
  if(ts.isPropertyAccessExpression(node)&&['clipboard','clipboardData'].includes(node.name.text))throw Error(`Custom clipboard access is retired: ${where}`);
  if(ts.isClassDeclaration(node)&&node.heritageClauses?.some(clause=>clause.types.some(type=>type.expression.getText(source)==='PluginSettingTab'))&&node.members.some(member=>ts.isMethodDeclaration(member)&&member.name.getText(source)==='display'))throw Error(`Legacy settings renderer is retired: ${where}`);
  ts.forEachChild(node,check);
 }
 check(source);
 for(const declaration of source.statements){
  if(!ts.isImportDeclaration(declaration)&&!ts.isExportDeclaration(declaration)||!declaration.moduleSpecifier||!ts.isStringLiteral(declaration.moduleSpecifier))continue;
  const name=declaration.moduleSpecifier.text;
  if(isBuiltin(name)){
   if(name==='buffer')throw Error(`${relative(root,file)} must select the browser buffer/ package explicitly`);
   throw Error(`${relative(root,file)} declares a static Node import; use guarded dynamic imports for runtime and import() type queries for types`);
  }
  const clause=declaration.importClause;
  if(declaration.isTypeOnly||clause?.isTypeOnly||clause&&!clause.name&&clause.namedBindings&&ts.isNamedImports(clause.namedBindings)&&clause.namedBindings.elements.every(item=>item.isTypeOnly))continue;
  if(name.startsWith('.')){const prefix=resolve(dirname(file),name),target=[prefix,prefix+'.ts',join(prefix,'index.ts')].find(candidate=>known.has(candidate));if(target)edges.push(target)}
 }
 graph.set(file,edges);
}
const visited=new Set();function visit(file){if(visited.has(file))return;visited.add(file);if(nodeFiles.has(file))throw Error(`Portable entry eagerly loads ${relative(root,file)}`);for(const next of graph.get(file)??[])visit(next)}
visit(join(root,'src/app/main.ts'));
console.log(`Platform boundaries: ${visited.size} portable modules; all Node runtime imports deferred; no static Node declarations or require-style source imports.`);
