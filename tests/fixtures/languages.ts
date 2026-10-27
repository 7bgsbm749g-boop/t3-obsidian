import type {CodeGrammar,CodeViewType} from '../../code-language';

export interface LanguageFixture {
  name:string;
  extension:string;
  type:CodeViewType;
  grammar:CodeGrammar;
  raw:string;
  classes:readonly string[];
}

/** Shared by parser tests and the real, unsynced Obsidian client lab. */
export const languageFixtures:readonly LanguageFixture[]=[
  {name:'TypeScript',extension:'ts',type:'typescript',grammar:'typescript',raw:'const message: string = "hello";\r\nconst count: number = 42;',classes:['tok-keyword','tok-string','tok-number']},
  {name:'TSX',extension:'tsx',type:'typescript',grammar:'tsx',raw:'const count: number = 42;\r\nconst element = <div title="hello">{count}</div>;',classes:['tok-keyword','tok-string','tok-number']},
  {name:'JavaScript',extension:'js',type:'javascript',grammar:'javascript',raw:'const message = "hello";\r\nconst count = 42;',classes:['tok-keyword','tok-string','tok-number']},
  {name:'JSX',extension:'jsx',type:'javascript',grammar:'jsx',raw:'const count = 42;\r\nconst element = <div title="hello">{count}</div>;',classes:['tok-keyword','tok-string','tok-number']},
  {name:'JSON',extension:'json',type:'json',grammar:'json',raw:'{\r\n    "message": "hello",\n    "count": 42\r\n}',classes:['tok-string','tok-number']},
  {name:'CSS',extension:'css',type:'css',grammar:'css',raw:'.box {\r\n    content: "hello";\n\twidth: 42px;\r\n}',classes:['tok-string','tok-number']},
  {name:'Python',extension:'py',type:'python',grammar:'python',raw:'def greet():\r\n    message = "hello"\n    return 42',classes:['tok-keyword','tok-string','tok-number']},
  {name:'C',extension:'c',type:'c',grammar:'c',raw:'int main(void) {\r\n    const char *message = "hello";\n\treturn 42;\r\n}',classes:['tok-keyword','tok-string','tok-number']},
  {name:'C++',extension:'cpp',type:'cpp',grammar:'cpp',raw:'#include <string>\r\nint main() {\n    std::string message = "hello";\r\n\treturn 42;\n}',classes:['tok-keyword','tok-string','tok-number']},
  {name:'Java',extension:'java',type:'java',grammar:'java',raw:'class Greeting {\r\n    String message = "hello";\n\tint count = 42;\r\n}',classes:['tok-keyword','tok-string','tok-number']},
  {name:'C#',extension:'cs',type:'csharp',grammar:'csharp',raw:'class Greeting {\r\n    string message = "hello";\n\tint count = 42;\r\n}',classes:['tok-keyword','tok-string','tok-number']},
  {name:'Visual Basic',extension:'vb',type:'visual-basic',grammar:'visual-basic',raw:'Module Greeting\r\n    Dim message As String = "hello"\n    Dim count As Integer = 42\r\nEnd Module',classes:['tok-keyword','tok-string','tok-number']},
  {name:'SQL',extension:'sql',type:'sql',grammar:'sql',raw:'SELECT name, 42 AS count\r\nFROM greetings\nWHERE message = \'hello\';',classes:['tok-keyword','tok-string','tok-number']},
  {name:'R',extension:'r',type:'r',grammar:'r',raw:'greet <- function() {\r\n    message <- "hello"\n\treturn(42)\r\n}',classes:['tok-keyword','tok-string','tok-number']},
  {name:'Rust',extension:'rs',type:'rust',grammar:'rust',raw:'fn main() {\r\n    let message = "hello";\n\tlet count: i32 = 42;\r\n}',classes:['tok-keyword','tok-string','tok-number']},
  {name:'Go',extension:'go',type:'go',grammar:'go',raw:'package main\r\nfunc main() {\n\tmessage := "hello"\r\n\tcount := 42\n\t_, _ = message, count\n}',classes:['tok-keyword','tok-string','tok-number']},
  {name:'PHP',extension:'php',type:'php',grammar:'php',raw:'<?php\r\nfunction greet() {\n    $message = "hello";\r\n\treturn 42;\n}\n?>',classes:['tok-keyword','tok-string','tok-number']},
  {name:'Ruby',extension:'rb',type:'ruby',grammar:'ruby',raw:'def greet\r\n    message = "hello"\n    return 42\r\nend',classes:['tok-keyword','tok-string','tok-number']},
  {name:'Kotlin',extension:'kt',type:'kotlin',grammar:'kotlin',raw:'fun main() {\r\n    val message = "hello"\n\tval count = 42\r\n}',classes:['tok-keyword','tok-string','tok-number']},
  {name:'Swift',extension:'swift',type:'swift',grammar:'swift',raw:'func greet() -> Int {\r\n    let message = "hello"\n\treturn 42\r\n}',classes:['tok-keyword','tok-string','tok-number']},
  {name:'Dart',extension:'dart',type:'dart',grammar:'dart',raw:'int greet() {\r\n    var message = "hello";\n\treturn 42;\r\n}',classes:['tok-keyword','tok-string','tok-number']},
  {name:'Bash',extension:'sh',type:'bash',grammar:'bash',raw:'#!/bin/bash\r\nmessage="hello"\nif true; then\r\n    echo "$message"\nfi\ncount=42',classes:['tok-keyword','tok-string']},
  {name:'PowerShell',extension:'ps1',type:'powershell',grammar:'powershell',raw:'function Get-Greeting {\r\n    $message = "hello"\n\treturn 42\r\n}',classes:['tok-keyword','tok-string','tok-number']},
  {name:'Lua',extension:'lua',type:'lua',grammar:'lua',raw:'local function greet()\r\n    local message = "hello"\n\treturn 42\r\nend',classes:['tok-keyword','tok-string','tok-number']},
  {name:'HTML',extension:'html',type:'html',grammar:'html',raw:'<!doctype html>\r\n<html>\n    <body><p title="hello">42</p></body>\r\n</html>',classes:['tok-string']},
  {name:'YAML',extension:'yaml',type:'yaml',grammar:'yaml',raw:'greeting:\r\n    message: "hello"\n    count: 42',classes:['tok-string','tok-propertyName']},
  {name:'TOML',extension:'toml',type:'toml',grammar:'toml',raw:'[greeting]\r\nmessage = "hello"\ncount = 42',classes:['tok-string','tok-number']},
  {name:'XML',extension:'xml',type:'xml',grammar:'xml',raw:'<?xml version="1.0"?>\r\n<greeting message="hello">\n    <count>42</count>\r\n</greeting>',classes:['tok-string']},
];
