import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { handle } from './handler.js';

test('stateless Vercel API: same-origin CSRF, encrypted session, files and ZIP', async t => {
  const previous = {
    SCM_SESSION_KEY:process.env.SCM_SESSION_KEY,
    DEMO_MODE:process.env.DEMO_MODE,
    VERCEL_ENV:process.env.VERCEL_ENV,
    ENABLE_CLOUD_DELETE:process.env.ENABLE_CLOUD_DELETE,
  };
  process.env.SCM_SESSION_KEY=randomBytes(32).toString('base64url');
  process.env.DEMO_MODE='true';
  process.env.VERCEL_ENV='preview';
  delete process.env.ENABLE_CLOUD_DELETE;
  t.after(()=>{
    for(const [name,value] of Object.entries(previous)) {
      if(value===undefined)delete process.env[name];else process.env[name]=value;
    }
  });
  const server=createServer((req,res)=>{void handle(req,res);});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>server.close());
  const addr=server.address();
  if(!addr||typeof addr==='string')throw new Error('No listener');
  const base='http://127.0.0.1:'+addr.port;
  const headers={Origin:base};
  const guest=await fetch(base+'/api/session');
  assert.equal(guest.status,200);
  const guestCookie=guest.headers.get('set-cookie')?.split(';')[0]||'';
  const initial=await guest.json() as {csrfToken:string;mode:string};
  assert.equal(initial.mode,'demo');
  assert.match(guestCookie,/^__Host-scm-guest=/);
  const wrongCsrf=await fetch(base+'/api/auth/steam',{method:'POST',
    headers:{...headers,Cookie:guestCookie,'X-CSRF-Token':'invalid'}});
  assert.equal(wrongCsrf.status,403);
  const login=await fetch(base+'/api/auth/steam',{method:'POST',
    headers:{...headers,Cookie:guestCookie,'X-CSRF-Token':initial.csrfToken}});
  assert.equal(login.status,200);
  const logged=await login.json() as {csrfToken:string;login:{status:string}};
  assert.equal(logged.login.status,'connected');
  const session=login.headers.get('set-cookie')?.split(';')[0]||'';
  assert.match(session,/^__Host-scm=/);
  assert.ok(!session.includes('demo-session'));
  const anon=await fetch(base+'/api/games');
  assert.equal(anon.status,401);
  const games=await fetch(base+'/api/games',{headers:{Cookie:session}});
  assert.equal(games.status,200);
  const inventory=await games.json() as {games:Array<{appId:number}>};
  assert.ok(inventory.games.some(game=>game.appId===949230));
  const foreign=await fetch(base+'/api/auth/logout',{method:'POST',
    headers:{Origin:'https://untrusted.example',Cookie:session,'X-CSRF-Token':logged.csrfToken}});
  assert.equal(foreign.status,403);
  const files=await fetch(base+'/api/games/949230/files',{headers:{Cookie:session}});
  assert.equal(files.status,200);
  const listing=await files.json() as {files:Array<{name:string;size:number}>;revision:string};
  assert.ok(listing.files.length>0);
  const file=listing.files[0];
  const one=await fetch(base+'/api/games/949230/download?name='+encodeURIComponent(file.name),{
    headers:{Cookie:session},
  });
  assert.equal(one.status,200);
  assert.equal((await one.arrayBuffer()).byteLength,file.size);
  const selection={names:[file.name],revision:listing.revision};
  const archive=await fetch(base+'/api/games/949230/exports',{method:'POST',
    headers:{...headers,Cookie:session,'Content-Type':'application/json','X-CSRF-Token':logged.csrfToken},
    body:JSON.stringify(selection),
  });
  assert.equal(archive.status,200);
  assert.equal(archive.headers.get('content-type'),'application/zip');
  const zip=Buffer.from(await archive.arrayBuffer());
  assert.equal(zip.subarray(0,2).toString(),'PK');
  assert.ok(zip.includes(Buffer.from('manifest.json')));
  assert.ok(zip.includes(Buffer.from('DEMO ONLY')));
  const deleteReview=await fetch(base+'/api/games/949230/delete-plan',{method:'POST',
    headers:{...headers,Cookie:session,'Content-Type':'application/json','X-CSRF-Token':logged.csrfToken},
    body:JSON.stringify(selection),
  });
  assert.equal(deleteReview.status,503);
  assert.equal((await deleteReview.json()).error.code,'DELETE_DISABLED');
  const loggedOut=await fetch(base+'/api/auth/logout',{method:'POST',
    headers:{...headers,Cookie:session,'X-CSRF-Token':logged.csrfToken},body:'{}'});
  assert.equal(loggedOut.status,200);
  assert.match(loggedOut.headers.get('set-cookie')||'',/Max-Age=0/);
});

test('malformed or expired session is rejected, not downgraded to another account',async t=>{
  const previous=process.env.SCM_SESSION_KEY;
  process.env.SCM_SESSION_KEY=randomBytes(32).toString('base64url');
  t.after(()=>{if(previous===undefined)delete process.env.SCM_SESSION_KEY;else process.env.SCM_SESSION_KEY=previous;});
  const server=createServer((req,res)=>{void handle(req,res);});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>server.close());
  const addr=server.address();
  if(!addr||typeof addr==='string')throw new Error('No listener');
  const res=await fetch('http://127.0.0.1:'+addr.port+'/api/games',{
    headers:{Cookie:'__Host-scm=invalid_token'},
  });
  assert.equal(res.status,401);
});
