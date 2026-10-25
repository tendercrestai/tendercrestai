// Local context preview only: no model/provider calls, writes or submissions.
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{pilot}=require('../netlify/functions/lib/reference-catalogue');
try{
 const file=process.argv[2];if(!file||process.argv.length!==3)throw Error('Usage: node scripts/reference-pilot.mjs <UTF-8 extracted RFP text file>');
 if((await stat(file)).size>120000)throw Error('Pilot text file exceeds its byte bound');
 const bytes=await readFile(file),query=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 console.log(JSON.stringify(pilot(fileURLToPath(new URL('../reference-library/',import.meta.url)),{jurisdiction:'US federal',sector:'IT',query}),null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
