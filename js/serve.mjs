import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=fileURLToPath(new URL('./',import.meta.url));
const port=Number(process.env.PORT||4192);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PORT');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
http.createServer((req,res)=>{
  if(req.headers.host!=='127.0.0.1:'+port||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:'+port)){res.writeHead(403);res.end();return;}
  try{const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(base,'.'+(rel==='/'?'/index.html':rel));if(rel.split('/').some(p=>p.startsWith('.'))||!file.startsWith(base)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);}catch{res.writeHead(400);res.end();}
}).listen(port,'127.0.0.1',()=>console.log('Harmony Lab: http://127.0.0.1:'+port+'/'));
