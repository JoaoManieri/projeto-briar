// Versão do próximo release, usada pelo workflow a cada push na main:
// - normalmente é a última tag vX.Y.Z com o patch + 1 (v0.6.2 → 0.6.3);
// - se o package.json tiver uma versão maior (ex.: alguém subiu para 0.7.0 ou 1.0.0), vale ela.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const parse=v=>String(v).replace(/^v/,'').split('-')[0].split('.').map(n=>parseInt(n,10)||0);
const cmp=(a,b)=>{for(let i=0;i<3;i++)if((a[i]||0)!==(b[i]||0))return (a[i]||0)-(b[i]||0);return 0;};

const tags=execFileSync('git',['tag','--list','v*'],{encoding:'utf8'}).split('\n').map(t=>t.trim()).filter(t=>/^v\d+\.\d+\.\d+$/.test(t)).map(parse).sort(cmp);
const last=tags.at(-1);
const pkg=parse(JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);
const next=!last||cmp(pkg,last)>0?pkg:[last[0],last[1],last[2]+1];
console.log(next.slice(0,3).join('.'));
