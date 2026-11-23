import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
const exec=promisify(execFile);
const script=path.resolve(import.meta.dirname,'../scripts/update-info.mjs');

// Simula o instalador depois de assinado: o arquivo muda e o latest.yml precisa acompanhar.
test('update-info: corrige sha512 e tamanho do instalador no latest.yml e refaz o blockmap',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'briar-update-info-'));
 const exe=path.join(dir,'Briar-Setup.exe'),yml=path.join(dir,'latest.yml');
 const data=randomBytes(700000);await writeFile(exe,data);
 await writeFile(yml,"version: 1.2.3\nfiles:\n  - url: Briar-Setup.exe\n    sha512: VELHO==\n    size: 10\n  - url: Briar-Portable.exe\n    sha512: OUTRO==\n    size: 20\npath: Briar-Setup.exe\nsha512: VELHO==\nreleaseDate: '2026-11-23T10:00:00.000Z'\n");
 await exec(process.execPath,[script,exe,yml]);
 const sha=createHash('sha512').update(data).digest('base64');
 const out=await readFile(yml,'utf8');
 assert.equal(out,`version: 1.2.3\nfiles:\n  - url: Briar-Setup.exe\n    sha512: ${sha}\n    size: 700000\n  - url: Briar-Portable.exe\n    sha512: OUTRO==\n    size: 20\npath: Briar-Setup.exe\nsha512: ${sha}\nreleaseDate: '2026-11-23T10:00:00.000Z'\n`);
 const map=JSON.parse(gunzipSync(await readFile(exe+'.blockmap')));
 assert.equal(map.files[0].sizes.reduce((a,b)=>a+b,0),700000);
 await assert.rejects(()=>exec(process.execPath,[script,path.join(dir,'Outro.exe'),yml]));
});
