import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { finished } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import QRCode from 'qrcode';
import { SteamCloudDriver } from '../steam/steam-driver.js';
import { DemoCloudDriver } from '../demo-driver.js';
import type { CloudDriver } from '../steam/contracts.js';
import { fileRevision, selectFiles, archiveEntryName, contentDisposition } from '../files.js';
import { decryptToken, encryptToken, sessionEncryptionKey, type TokenPayload } from './token.js';

type Req = IncomingMessage & {body?:unknown;query?:Record<string,unknown>};
type Res = ServerResponse;
const SESSION='__Host-scm', GUEST='__Host-scm-guest', LOGIN='__Host-scm-login';
const TTL=60*60_000, QR_TTL=120_000;
const COOKIE_LIMIT=3900;
class ApiFailure extends Error {
  constructor(readonly status:number,readonly code:string,message:string){super(message);}
}
function cookies(req:Req,name:string):string {
  return req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
}
function cookie(name:string,value:string,seconds:number) {
  return name+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+seconds;
}
function setCookie(res:Res,...values:string[]) {
  const old=res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie',[...(Array.isArray(old)?old:old?[String(old)]:[]),...values]);
}
function json(res:Res,status:number,value:unknown) {
  if(res.headersSent)return;
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(value));
}
function respondError(res:Res,e:unknown) {
  if(res.headersSent){res.destroy();return;}
  if(e instanceof ApiFailure) return json(res,e.status,{error:{code:e.code,message:e.message}});
  const known=e as {name?:string;statusCode?:number;code?:string};
  if(known?.name==='SteamServiceError') return json(res,known.statusCode||502,{error:{
    code:known.code||'STEAM_UNAVAILABLE',message:'Steam не выполнил запрос. Обновите список и попробуйте снова.'}});
  json(res,502,{error:{code:'STEAM_UNAVAILABLE',message:'Не удалось выполнить запрос к Steam.'}});
}
function equal(a:string,b:string):boolean {
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}
function csrf(req:Req,expected:string,form?:unknown) {
  const actual=typeof form==='string'?form:
    typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:'';
  if(!expected||!equal(actual,expected))throw new ApiFailure(403,'CSRF_FAILED','Обновите страницу.');
}
function origin(req:Req,method:string) {
  const host=req.headers.host||'';
  if(!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host)||host.length>253||host.includes('..'))
    throw new ApiFailure(403,'INVALID_HOST','Недопустимый адрес.');
  if(req.headers['sec-fetch-site']==='cross-site')
    throw new ApiFailure(403,'INVALID_ORIGIN','Недопустимый источник.');
  const local=process.env.DEMO_MODE==='true'&&process.env.VERCEL_ENV!=='production';
  if(method!=='GET'&&req.headers.origin!=='https://'+host&&
    !(local&&req.headers.origin==='http://'+host))
    throw new ApiFailure(403,'INVALID_ORIGIN','Недопустимый источник.');
}
function demo(){return process.env.DEMO_MODE==='true'&&process.env.VERCEL_ENV!=='production';}
function sessionOf(req:Req,key:Buffer):TokenPayload|null {
  const text=cookies(req,SESSION);
  if(!text||text.length>COOKIE_LIMIT)return null;
  const session=decryptToken(text,key,'steam-session');
  if(!session||!/^7656119\d{10}$/.test(session.steamId||'')||!session.refreshToken||
    !session.binding||Date.now()-session.issuedAt>TTL)return null;
  return session;
}
function authorized(req:Req,key:Buffer):TokenPayload {
  const user=sessionOf(req,key);
  if(!user)throw new ApiFailure(401,'SESSION_REQUIRED','Войдите через Steam заново.');
  return user;
}
async function body(req:Req):Promise<Record<string,unknown>> {
  if(req.body&&typeof req.body==='object'&&!Array.isArray(req.body)) {
    const data=req.body as Record<string,unknown>;
    if(typeof data.names==='string') {
      try{data.names=JSON.parse(data.names);}catch{throw new ApiFailure(400,'INVALID_INPUT','Неверные данные.');}
    }
    return data;
  }
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of req) {
    const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=b.length;
    if(size>3*1024*1024)throw new ApiFailure(413,'BODY_TOO_LARGE','Запрос слишком большой.');
    chunks.push(b);
  }
  const raw=Buffer.concat(chunks).toString('utf8');
  try{
    if(String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded')){
      const data=new URLSearchParams(raw);
      if(data.size>10)throw new Error();
      return {csrf:data.get('csrf'),revision:data.get('revision'),names:JSON.parse(data.get('names')||'null')};
    }
    const parsed:unknown=JSON.parse(raw||'{}');
    if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error();
    return parsed as Record<string,unknown>;
  }catch{throw new ApiFailure(400,'INVALID_INPUT','Неверные данные.');}
}
function appId(value:string) {
  const number=Number(value);
  if(!/^[1-9][0-9]*$/.test(value)||!Number.isSafeInteger(number)||number>0xffffffff)
    throw new ApiFailure(400,'INVALID_APPID','Неверный AppID.');
  return number;
}
function selection(data:Record<string,unknown>) {
  const names=data.names,revision=data.revision;
  if(!Array.isArray(names)||!names.length||names.length>500||names.some(x=>typeof x!=='string'||!x||x.length>4096)
    ||new Set(names).size!==names.length||typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))
    throw new ApiFailure(400,'INVALID_INPUT','Выберите от 1 до 500 файлов и обновите список.');
  return {names:names as string[],revision};
}
function digest(names:string[]) {
  return createHash('sha256').update(JSON.stringify([...names].sort())).digest('hex');
}
async function steamCall<T>(user:TokenPayload,fn:(driver:CloudDriver)=>Promise<T>):Promise<T> {
  const driver:CloudDriver=demo()?new DemoCloudDriver():new SteamCloudDriver({allowedSteamIds:[user.steamId!]});
  try{
    if(driver instanceof SteamCloudDriver)await driver.resumeWithToken(user.steamId!,user.refreshToken!);
    else await driver.startLogin();
    return await fn(driver);
  }finally{driver.close();}
}
function event(res:Res,type:string,data:unknown) {
  res.write('event: '+type+'\ndata: '+JSON.stringify(data)+'\n\n');
}
async function qr(req:Req,res:Res,key:Buffer,guest:string){
  csrf(req,guest);
  const auth=new LoginSession(EAuthTokenPlatformType.SteamClient,
    {machineFriendlyName:'Steam Cloud Manager',machineId:true});
  auth.loginTimeout=QR_TTL;
  const nonce=randomBytes(24).toString('base64url');
  setCookie(res,cookie(LOGIN,nonce,130));
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8',
    'Cache-Control':'no-store','X-Accel-Buffering':'no'});
  let closed=false;
  const abort=()=>{try{auth.cancelLoginAttempt();}catch{}auth.refreshToken='';auth.accessToken='';};
  res.once('close',()=>{closed=true;abort();});
  const ping=setInterval(()=>{if(!closed)res.write(': keepalive\n\n');},15000);
  const timeout=setTimeout(()=>{if(!closed){event(res,'expired',{});res.end();}},QR_TTL);
  try{
    const confirmed=new Promise<{steamId:string;refreshToken:string}>((resolve,reject)=>{
      auth.on('authenticated',()=>{
        const id=auth.steamID?.getSteamID64()||'';
        if(!/^7656119\d{10}$/.test(id)||!auth.refreshToken)return reject(new Error('Invalid Steam token'));
        resolve({steamId:id,refreshToken:auth.refreshToken});
      });
      auth.on('error',reject);
      auth.on('timeout',()=>reject(new Error('Steam QR expired')));
    });
    const challenge=await auth.startWithQR();
    if(closed||!challenge.qrChallengeUrl)return;
    event(res,'qr',{qrDataUrl:await QRCode.toDataURL(challenge.qrChallengeUrl,{width:240,margin:2}),
      expiresAt:Date.now()+QR_TTL});
    const result=await confirmed;
    if(!closed){
      const now=Date.now();
      const ticket=encryptToken({purpose:'login-handoff',issuedAt:now,expiresAt:now+45000,
        steamId:result.steamId,refreshToken:result.refreshToken,binding:guest+':'+nonce},key);
      event(res,'authenticated',{ticket});res.end();
    }
  }catch{if(!closed){event(res,'error',{code:'STEAM_AUTH_ERROR'});res.end();}}
  finally{clearInterval(ping);clearTimeout(timeout);abort();}
}
async function singleDownload(req:Req,res:Res,user:TokenPayload,id:number,url:URL){
  const name=url.searchParams.get('name');
  if(!name||name.length>4096)throw new ApiFailure(400,'INVALID_NAME','Неверное имя файла.');
  await steamCall(user,async driver=>{
    const listing=await driver.listFiles(id);
    const file=listing.files.find(f=>f.name===name);
    if(!file)throw new ApiFailure(404,'FILE_NOT_FOUND','Файл не найден.');
    const result=await driver.downloadFile(id,file);
    const abort=()=>result.stream.destroy();
    res.once('close',abort);
    try{
      res.writeHead(200,{'Content-Type':'application/octet-stream',
        'Content-Disposition':contentDisposition(file.name),'Content-Length':String(result.size)});
      await finished(result.stream.pipe(res),{cleanup:true});
    }finally{res.removeListener('close',abort);result.stream.destroy();}
  });
}
async function zipDownload(res:Res,user:TokenPayload,id:number,names:string[],revision:string){
  await steamCall(user,async driver=>{
    const files=selectFiles(await driver.listFiles(id),names,revision);
    const first=await driver.downloadFile(id,files[0]);
    const zip=new ZipArchive({store:true,forceZip64:true});
    res.writeHead(200,{'Content-Type':'application/zip',
      'Content-Disposition':contentDisposition('steam-cloud-'+id+'.zip')});
    zip.on('error',()=>res.destroy());
    res.once('close',()=>{zip.abort();zip.destroy();});
    zip.pipe(res);
    zip.append(JSON.stringify({appId:id,exportedAt:new Date().toISOString(),
      files:files.map((f,i)=>({...f,archivePath:archiveEntryName(f,i)}))},null,2),{name:'manifest.json'});
    try{
      for(const [i,file] of files.entries()){
        const stream=i===0?first.stream:(await driver.downloadFile(id,file)).stream;
        const complete=finished(stream,{cleanup:true});
        zip.append(stream,{name:archiveEntryName(file,i),date:new Date(file.modifiedAt*1000)});
        await complete;
      }
      await zip.finalize();await finished(res,{cleanup:true});
    }catch{zip.destroy();res.destroy();}
  });
}
export async function handle(req:Req,res:Res):Promise<void>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Robots-Tag','noindex,nofollow');
  try{
    const method=(req.method||'GET').toUpperCase();
    if(!['GET','POST'].includes(method))throw new ApiFailure(405,'METHOD_NOT_ALLOWED','Метод не поддерживается.');
    origin(req,method);
    const url=new URL(req.url||'/', 'https://'+req.headers.host);
    const query=typeof req.query?.route==='string'?req.query.route:url.searchParams.get('route');
    const route=query?'/api/'+query:url.pathname;
    if(!route.startsWith('/api/'))throw new ApiFailure(404,'NOT_FOUND','Маршрут не найден.');
    if(route==='/api/health'&&method==='GET')return json(res,200,{status:'ok',mode:'serverless'});
    const key=sessionEncryptionKey();
    const active=sessionOf(req,key);
    const guest=cookies(req,GUEST)||randomBytes(32).toString('base64url');
    if(!cookies(req,GUEST))setCookie(res,cookie(GUEST,guest,600));
    if(route==='/api/session'&&method==='GET')return json(res,200,{csrfToken:active?.binding||guest,
      mode:demo()?'demo':'live',login:active?{status:'connected',user:{steamId:active.steamId,displayName:'Steam'}}:{status:'disconnected'}});
    if(route==='/api/auth/steam'&&method==='POST'){
      if(demo()){
        csrf(req,guest);const now=Date.now();
        const claims:TokenPayload={purpose:'steam-session',issuedAt:now,expiresAt:now+TTL,
          steamId:'76561198000000000',refreshToken:'demo',binding:randomBytes(32).toString('base64url')};
        setCookie(res,cookie(SESSION,encryptToken(claims,key),3600));
        return json(res,200,{csrfToken:claims.binding,mode:'demo',
          login:{status:'connected',user:{steamId:claims.steamId,displayName:'Demo'}}});
      }
      return qr(req,res,key,guest);
    }
    if(route==='/api/auth/exchange'&&method==='POST'){
      csrf(req,guest);
      const data=await body(req);
      const claim=decryptToken(typeof data.ticket==='string'?data.ticket:undefined,key,'login-handoff');
      if(!claim||!claim.steamId||!claim.refreshToken||!equal(claim.binding||'',guest+':'+cookies(req,LOGIN)))
        throw new ApiFailure(401,'LOGIN_EXPIRED','Повторите вход через Steam Guard.');
      const now=Date.now();
      const claims:TokenPayload={purpose:'steam-session',issuedAt:now,expiresAt:now+TTL,
        steamId:claim.steamId,refreshToken:claim.refreshToken,binding:randomBytes(32).toString('base64url')};
      const value=encryptToken(claims,key);
      if(value.length>COOKIE_LIMIT)throw new ApiFailure(502,'SESSION_TOO_LARGE','Токен Steam слишком длинный.');
      setCookie(res,cookie(SESSION,value,3600),cookie(LOGIN,'',0));
      return json(res,200,{csrfToken:claims.binding,mode:'live',
        login:{status:'connected',user:{steamId:claims.steamId,displayName:'Steam'}}});
    }
    if(route==='/api/auth/logout'&&method==='POST'){
      csrf(req,active?.binding||guest);
      setCookie(res,cookie(SESSION,'',0),cookie(LOGIN,'',0));
      return json(res,200,{csrfToken:guest,mode:demo()?'demo':'live',login:{status:'disconnected'}});
    }
    const user=authorized(req,key);
    if(route==='/api/games'&&method==='GET')
      return json(res,200,{games:await steamCall(user,driver=>driver.listGames())});
    if(route==='/api/games/summaries'&&method==='POST'){
      const data=await body(req);
      csrf(req,user.binding!);
      const ids=data.ids;
      if(!Array.isArray(ids)||ids.length<1||ids.length>8||
        ids.some(id=>!Number.isSafeInteger(id)||id<1||id>0xffffffff)||
        new Set(ids).size!==ids.length) throw new ApiFailure(400,'INVALID_INPUT','Неверный список AppID.');
      const summaries=await steamCall(user,async driver=>{
        const items:{appId:number;fileCount?:number;totalBytes?:number;error?:string}[]=[];
        // Sequential on one Steam connection avoids N function logins and Steam rate spikes.
        for(const id of ids as number[]){
          try{
            const entry=await driver.listFiles(id);
            items.push({appId:id,fileCount:entry.files.length,
              totalBytes:entry.files.reduce((sum,file)=>sum+file.size,0)});
          }catch{
            items.push({appId:id,error:'STEAM_UNAVAILABLE'});
          }
        }
        return items;
      });
      return json(res,200,{summaries});
    }
    const match=/^\/api\/games\/(\d+)\/(files|summary|download|exports|delete-plan|delete)$/.exec(route);
    if(!match)throw new ApiFailure(404,'NOT_FOUND','Маршрут не найден.');
    const id=appId(match[1]),op=match[2];
    if(op==='files'&&method==='GET'){
      const files=await steamCall(user,driver=>driver.listFiles(id));
      return json(res,200,{appId:files.appId,files:files.files,revision:fileRevision(files)});
    }
    if(op==='summary'&&method==='GET'){
      const listing=await steamCall(user,driver=>driver.listFiles(id));
      return json(res,200,{appId:id,fileCount:listing.files.length,
        totalBytes:listing.files.reduce((n,f)=>n+f.size,0)});
    }
    if(op==='download'&&method==='GET')return singleDownload(req,res,user,id,url);
    if(method!=='POST')throw new ApiFailure(405,'METHOD_NOT_ALLOWED','Метод не поддерживается.');
    const data=await body(req);
    csrf(req,user.binding!,op==='exports'?data.csrf:undefined);
    if(op==='exports'){
      const {names,revision}=selection(data);
      return zipDownload(res,user,id,names,revision);
    }
    if(op==='delete-plan'){
      if(process.env.ENABLE_CLOUD_DELETE!=='true')throw new ApiFailure(503,'DELETE_DISABLED','Удаление отключено до проверки защиты повторных запросов.');
      const {names,revision}=selection(data);
      const files=await steamCall(user,async driver=>selectFiles(await driver.listFiles(id),names,revision));
      const now=Date.now();
      const plan=encryptToken({purpose:'review-plan',issuedAt:now,expiresAt:now+300000,
        steamId:user.steamId,binding:user.binding,appId:id,revision,names:[digest(names)]},key);
      return json(res,200,{planId:plan,appId:id,files,totalBytes:files.reduce((n,f)=>n+f.size,0),
        expiresAt:now+300000,confirmation:'DELETE '+files.length});
    }
    if(op==='delete'){
      if(process.env.ENABLE_CLOUD_DELETE!=='true')throw new ApiFailure(503,'DELETE_DISABLED','Удаление отключено до проверки защиты повторных запросов.');
      const plan=decryptToken(typeof data.planId==='string'?data.planId:undefined,key,'review-plan');
      const {names}=selection({names:data.names,revision:plan?.revision});
      if(!plan||plan.appId!==id||plan.steamId!==user.steamId||plan.binding!==user.binding||
        data.confirmation!=='DELETE '+names.length||data.gamesClosed!==true||plan.names?.[0]!==digest(names))
        throw new ApiFailure(409,'PLAN_EXPIRED','Подтверждение недействительно.');
      const result=await steamCall(user,async driver=>{
        const listing=await driver.listFiles(id);
        return driver.deleteFiles(id,selectFiles(listing,names,plan.revision!));
      });
      return json(res,200,result);
    }
    throw new ApiFailure(405,'METHOD_NOT_ALLOWED','Метод не поддерживается.');
  }catch(e){respondError(res,e);}
}
