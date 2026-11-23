// Depois que a SignPath assina o instalador do Windows, o arquivo muda (a assinatura vai dentro dele).
// Este script refaz o .blockmap (usado na atualização diferencial) e corrige o sha512 e o tamanho do
// instalador no latest.yml, que o atualizador automático do Briar confere antes de instalar.
// Uso: node scripts/update-info.mjs release/Briar-Setup.exe release/latest.yml
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
// Mesmo algoritmo que o electron-builder usa ao gerar o instalador.
const {buildBlockMap}=require('app-builder-lib/out/targets/blockmap/blockmap.js');

const [installer,yml]=process.argv.slice(2);
if(!installer||!yml){console.error('Uso: node scripts/update-info.mjs <instalador> <latest.yml>');process.exit(1);}
const name=path.basename(installer);
const {sha512,size}=await buildBlockMap(installer,'gzip',`${installer}.blockmap`);

// latest.yml: "files:" lista cada arquivo (url, sha512, size…); "path"/"sha512" no topo repetem o principal.
const unquote=v=>v.trim().replace(/^(['"])(.*)\1$/,'$2');
let file=null,top=null,changed=0;
const lines=(await readFile(yml,'utf8')).split('\n').map(line=>{
 let m;
 if((m=/^\s*- url:\s*(.+)$/.exec(line))){file=unquote(m[1]);return line;}
 if(/^\S/.test(line))file=null;
 if((m=/^path:\s*(.+)$/.exec(line))){top=unquote(m[1]);return line;}
 if(file===name&&(m=/^(\s+)sha512:/.exec(line))){changed++;return `${m[1]}sha512: ${sha512}`;}
 if(file===name&&(m=/^(\s+)size:/.exec(line))){changed++;return `${m[1]}size: ${size}`;}
 if(top===name&&/^sha512:/.test(line)){changed++;return `sha512: ${sha512}`;}
 return line;
});
if(!changed){console.error(`${name} não aparece em ${yml}.`);process.exit(1);}
await writeFile(yml,lines.join('\n'));
console.log(`${yml}: ${name} com ${size} bytes, sha512 ${sha512.slice(0,16)}… (${changed} campos) e ${name}.blockmap refeito.`);
