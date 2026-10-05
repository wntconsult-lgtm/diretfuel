import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('bulk imports generate unique identifiers even in the same millisecond',()=>{
  const source=fs.readFileSync('public/directfuel-app.js','utf8').split("const DBKEY")[0];
  const fixedMath=Object.create(Math);
  fixedMath.random=()=>0.5;
  const context={Date:class extends Date{static now(){return 1700000000000}},Math:fixedMath,generated:null};
  vm.createContext(context);
  vm.runInContext(`${source};generated=Array.from({length:5000},()=>uid('SAPPOST'));`,context);
  assert.equal(context.generated.length,5000);
  assert.equal(new Set(context.generated).size,5000);
  assert.ok(context.generated.every(id=>id.length<=120));
});
