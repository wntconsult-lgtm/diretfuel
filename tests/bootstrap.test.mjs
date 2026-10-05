import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../public/directfuel-bootstrap.js',import.meta.url),'utf8');
async function boot(failure=false) {
  const events=[], nodes=new Map(['directfuel-loading','directfuel-loading-style','directfuel-loading-message','directfuel-loading-retry'].map(id=>[id,{dataset:{version:'58'},remove(){events.push('remove:'+id);nodes.delete(id);}}]));
  let inflight=0,max=0;
  const window={addEventListener(){},removeEventListener(){},directFuelStartSync:async()=>{events.push('data');}};
  const document={getElementById:id=>nodes.get(id),createElement:()=>({}),head:{append(s){inflight++;max=Math.max(max,inflight);events.push(s.src);setTimeout(()=>{inflight--;failure && s.src.includes('enterprise.js')?s.onerror():s.onload();},Math.random()*5);}}};
  await vm.runInNewContext(source,{window,document,URL,location:{href:'https://example.test/'},console:{error(){}},setTimeout:(f,n)=>{const t=setTimeout(f,n);t.unref();return t;},clearTimeout,render:()=>events.push('render')});
  return {events,nodes,max};
}
test('scripts execute serially and screen is revealed only after data',async()=>{const {events,nodes,max}=await boot();assert.equal(max,1);assert.ok(events.indexOf('/directfuel-import-rules.js?v=58')<events.indexOf('/directfuel-app.js?v=58'));assert.ok(events.indexOf('/directfuel-app.js?v=58')<events.indexOf('/directfuel-enterprise.js?v=58'));assert.ok(events.indexOf('/directfuel-danfe-parser.js?v=58')<events.indexOf('/directfuel-invoices.js?v=58'));assert.ok(events.indexOf('data')<events.indexOf('remove:directfuel-loading-style'));assert.equal(nodes.has('directfuel-loading'),false);});
test('failed dependency stops startup and keeps partial screen hidden',async()=>{const {events,nodes}=await boot(true);assert.equal(events.includes('data'),false);assert.equal(nodes.has('directfuel-loading-style'),true);assert.equal(nodes.get('directfuel-loading-retry').hidden,false);});
