import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const window={};
vm.runInNewContext(readFileSync(new URL("../public/directfuel-reconciliation.js",import.meta.url),"utf8"),{window});
const {automaticLinks}=window.DirectFuelReconciliation;

test("links one NF to the exact DirectFuel fueling by product, date and volume",()=>{
  const notes=[{emissao:"2026-08-31",itensFiscais:[{produtoDirectFuelId:"diesel",quantidade:266}]}];
  const fuelings=[
    {id:"AB-1",data:"2026-08-30",produtoId:"diesel",qt:266},
    {id:"AB-2",data:"2026-08-31",produtoId:"diesel",qt:266},
    {id:"AB-3",data:"2026-08-31",produtoId:"arla",qt:266}
  ];
  assert.deepEqual([...automaticLinks(notes,fuelings).get(notes[0])],["AB-2"]);
});

test("links a consolidated NF to several chronological fuelings",()=>{
  const notes=[{emissao:"2026-09-03",itensFiscais:[{produtoDirectFuelId:"diesel",quantidade:800}]}];
  const fuelings=[{id:"AB-1",data:"2026-09-01",produtoId:"diesel",qt:266},{id:"AB-2",data:"2026-09-02",produtoId:"diesel",qt:310},{id:"AB-3",data:"2026-09-03",produtoId:"diesel",qt:224}];
  assert.deepEqual([...automaticLinks(notes,fuelings).get(notes[0])],["AB-1","AB-2","AB-3"]);
});

test("does not reuse a fueling across invoices and excludes future dates",()=>{
  const notes=[{emissao:"2026-09-01",itensFiscais:[{produtoDirectFuelId:"diesel",quantidade:100}]},{emissao:"2026-09-02",itensFiscais:[{produtoDirectFuelId:"diesel",quantidade:100}]}];
  const fuelings=[{id:"AB-1",data:"2026-09-01",produtoId:"diesel",qt:100},{id:"AB-2",data:"2026-09-02",produtoId:"diesel",qt:100}];
  const links=automaticLinks(notes,fuelings);
  assert.deepEqual([...links.get(notes[0])],["AB-1"]);
  assert.deepEqual([...links.get(notes[1])],["AB-2"]);
});
