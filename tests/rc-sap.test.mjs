import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/directfuel-rc-sap.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window, Blob, TextEncoder, Uint8Array, Uint32Array, DataView, Date, Set, String, Number, Array, Math });
const api = window.DirectFuelRcSap;
const allocationOptions={centroCustoOrigem:'rateio'};
const state = {
  config: { params: { ivaSapCodigos: ["DP","L6","L5","MF"], rcSapContasContabeis: { "35012674": "449090" }, rcSapCategoriasContabeis: { "35012674": "K" }, rcSapGruposCompradores: { "35012674": "Con" }, rcSapFormaPagamento: "B", rcSapCentroCustoTransitorio: "300316000" } },
  acordos: [{id:"A1",numero:"AC-1",condicaoPagamento:"Boleto",postoId:"S1",produtoId:"P1",inicio:"2026-01-01",ivaSap:"DP"}],
  produtos: [{ id: "P1", sap: "35012674" }],
  unidades: [{ id: "U1", centroSap: "40180", depositoSap: "ZAAA" }],
  postos: [{ id: "S1", sap: "100200" }],
  abastecimentos: [
    { id: "AB1", data:"2026-09-01", postoId:"S1", unidadeId: "U1", produtoId: "P1", qt: 36.35, preco: 3.99 },
    { id: "AB2", data:"2026-09-02", postoId:"S1", unidadeId: "U1", produtoId: "P1", qt: 50, preco: 4.01 },
  ],
};
const approved = {
  id: "M1", numero: "MED-2026-0001", status: "Aprovada", postoId: "S1", itens: ["AB1", "AB2"],
  notasFiscais: [
    { numero: "640590", serie: "1", emissao: "2026-09-02", vencimento: "2026-09-15", abastecimentoIds: ["AB1"] },
    { numero: "640591", serie: "2", emissao: "2026-09-03", parcelas: [{ vencimento: "2026-09-20" }], abastecimentoIds: ["AB2"] },
  ],
};

test("RC SAP maps every fueling to its invoice and configured template values", () => {
  const result = api.buildRows(state, approved);
  assert.deepEqual([...result.errors], []);
  assert.deepEqual([...result.rows[0]], ["K", "35012674", "Con", 36.35, 3.99, "40180", "ZAAA", "100200", "", "449090", "300316000", "", "640590-1", "2026-09-02", "B", "2026-09-15", "DP"]);
  assert.equal(result.rows[1][12], "640591-2");
  assert.equal(result.rows[1][15], "2026-09-20");
});

test("RC SAP blocks measurements without final approval or mandatory SAP data", () => {
  const result = api.buildRows({ ...state, postos: [{ id: "S1", sap: "" }] }, { ...approved, status: "Confirmado" });
  assert.ok(result.errors.some(message => message.includes("medição aprovada")));
  assert.ok(result.errors.some(message => message.includes("Código SAP fornecedor")));
});

test("RC SAP creates a true XLSX package with the expected worksheet data", async () => {
  const result = api.create(state, approved);
  assert.deepEqual([...result.errors], []);
  assert.equal(result.filename, "RC_SAP_MED-2026-0001.xlsx");
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const packageText = new TextDecoder().decode(bytes);
  assert.match(packageText, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\.main\+xml/);
  assert.match(packageText, /640590-1/);
  assert.match(packageText, /Data Vencimento/);
});

test("RC SAP creates one consolidated workbook for selected approved measurements", async () => {
  const second = { ...approved, id: "M2", numero: "MED-2026-0002", itens: ["AB2"], notasFiscais: [approved.notasFiscais[1]] };
  const first = { ...approved, itens: ["AB1"], notasFiscais: [approved.notasFiscais[0]] };
  const result = api.createBatch(state, [first, second]);
  assert.deepEqual([...result.errors], []);
  assert.equal(result.rows.length, 2);
  assert.equal(result.filename, "RC_SAP_LOTE_2_MEDICOES.xlsx");
  const packageText = new TextDecoder().decode(new Uint8Array(await result.blob.arrayBuffer()));
  assert.match(packageText, /640590-1/);
  assert.match(packageText, /640591-2/);
});

test("RC SAP batch identifies the measurement that prevents generation", () => {
  const result = api.createBatch(state, [{ ...approved, status: "Confirmado" }]);
  assert.ok(result.errors.some(message => message.startsWith("MED-2026-0001:")));
});


test("RC uses configured account overrides and each vehicle's current cost center", () => {
  const custom = structuredClone(state);
  custom.config.params.rcSapContasContabeis["35012674"] = "123456";
  custom.frota = [{ placa: "ABC1D23", centroCusto: "111111111" }, { placa: "DEF4G56", centroCusto: "222222222" }];
  custom.abastecimentos[0].placa = "abc-1d23";
  custom.abastecimentos[0].centroCusto = "999999999";
  custom.abastecimentos[1].placa = "DEF4G56";
  const result = api.createBatch(custom, [approved], { centroCustoOrigem: "frota" });
  assert.deepEqual([...result.errors], []);
  assert.equal(result.rows[0][9], "123456");
  assert.equal(result.rows[0][10], "111111111");
  assert.equal(result.rows[1][10], "222222222");
  assert.equal(api.buildRows(custom, approved, { centroCustoOrigem: "transitorio" }).rows[0][10], "300316000");
});

test("RC blocks unknown or cleared accounts and missing fleet cost centers", () => {
  const custom = structuredClone(state);
  custom.produtos[0].sap = "99999999";
  assert.ok(api.create(custom, approved).errors.some(error => error.includes("Conta Contábil")));
  custom.produtos[0].sap = "35036604";
  assert.equal(api.buildRows(custom, approved).rows[0][9], "");
  custom.config = { params: { rcSapContasContabeis: { "35036604": "" } } };
  assert.equal(api.create(custom, approved).blob, undefined);
  const fleetResult = api.createBatch(state, [approved], { centroCustoOrigem: "frota" });
  assert.ok(fleetResult.errors.some(error => error.includes("cadastro da Frota")));
  assert.equal(fleetResult.blob, undefined);
});

 test("RC uses current material and unit tables, preserves codes and blocks missing settings", async () => {
  const custom = structuredClone(state);
  custom.config.params.rcSapCategoriasContabeis["35012674"] = "F";
  custom.config.params.rcSapGruposCompradores["35012674"] = "007";
  custom.config.params.rcSapFormaPagamento = "T";
  custom.config.params.rcSapContasContabeis["35012674"] = "00449090";
  custom.unidades[0].depositoSap = "D002";
  const result = api.create(custom, approved);
  assert.deepEqual([...result.errors], []);
  assert.equal(result.rows[0][0], "F");
  assert.equal(result.rows[0][2], "007");
  assert.equal(result.rows[0][6], "D002");
  assert.equal(result.rows[0][14], "B");
  const xml = new TextDecoder().decode(await result.blob.arrayBuffer());
  assert.match(xml, /r="C2"[^>]*.*?Grupo Comprador/);
  assert.match(xml, /r="J3"[^>]*t="inlineStr"><is><t>00449090/);
  assert.match(xml, /r="D3"[^>]*t="n"><v>36.35/);
  assert.doesNotMatch(xml, /Cond. Pg/);
  delete custom.config;
  custom.unidades[0].depositoSap = "";
  const missing = api.create(custom, approved);
  assert.equal(missing.blob, undefined);
  for (const field of ["Categoria", "Grupo Comprador", "Conta Contábil", "Transitório", "Depósito"]) assert.ok(missing.errors.some(e=>e.includes(field)), field);
 });

test('IVA varies independently by station/product and agreement period; XLSX keeps IVA as text in Q', async()=>{
 const custom=structuredClone(state);
 custom.produtos.push({id:'P2',sap:'35012674'});custom.postos.push({id:'S2',sap:'100201'});
 custom.acordos=[{id:'A1',postoId:'S1',produtoId:'P1',inicio:'2026-01-01',ivaSap:'L6'},{id:'A2',postoId:'S1',produtoId:'P2',inicio:'2026-01-01',ivaSap:'DP'},{id:'A3',postoId:'S2',produtoId:'P1',inicio:'2026-01-01',ivaSap:'L5'},{id:'A4',postoId:'S2',produtoId:'P2',inicio:'2026-01-01',ivaSap:'MF'}];
 custom.acordos.forEach(a=>a.condicaoPagamento='Boleto');
 custom.abastecimentos[1].produtoId='P2';
 const first=api.create(custom,approved);assert.deepEqual(first.rows.map(r=>r[16]),['L6','DP']);
 const xml=new TextDecoder().decode(await first.blob.arrayBuffer());assert.match(xml,/r="Q2".*?IVA SAP/);assert.match(xml,/r="Q3"[^>]*t="inlineStr"><is><t>L6/);
 custom.abastecimentos.forEach(a=>a.postoId='S2');assert.deepEqual(api.buildRows(custom,{...approved,postoId:'S2'}).rows.map(r=>r[16]),['L5','MF']);
 custom.acordos[2].fim='2026-09-01';custom.acordos.push({id:'A5',postoId:'S2',produtoId:'P1',inicio:'2026-09-02',ivaSap:'L6'});
 assert.equal(api.ivaFor(custom,{postoId:'S2'}, {...custom.abastecimentos[0],data:'2026-09-02'}).iva,'L6');
});
test('missing, malformed, unregistered or ambiguous IVA blocks all batch generation',()=>{
 for(const change of [s=>delete s.acordos[0].ivaSap,s=>s.acordos[0].ivaSap='BAD',s=>s.config.params.ivaSapCodigos=[],s=>s.acordos.push({...s.acordos[0],id:'duplicate'}),s=>s.abastecimentos[0].data='bad']){
  const custom=structuredClone(state);change(custom);const result=api.createBatch(custom,[approved]);assert.ok(result.errors.length);assert.equal(result.blob,undefined);
 }
});
test('stored IVA snapshot survives agreement edits and batch indexes identify original exported lines',()=>{
 const custom=structuredClone(state),m=structuredClone(approved),result=api.createBatch(custom,[m]);
 m.historico=[{acao:'RC SAP gerada',rcItems:result.items}];custom.acordos[0].ivaSap='MF';
 assert.equal(api.snapshotFor(m,'AB1').iva,'DP');assert.equal(api.buildRows(custom,m).rows[0][16],'MF');assert.equal(api.snapshotFor(m,'AB2').rowIndex,2);
});

function allocationFixture() {
 const s=structuredClone(state),m=structuredClone(approved);
 s.frota=[{placa:'ABC1D23',centroCusto:'001'},{placa:'DEF4G56',centroCusto:'002'}];
 s.abastecimentos=[
  {...s.abastecimentos[0],id:'AB1',placa:'ABC1D23',qt:100,preco:6,total:600},
  {...s.abastecimentos[1],id:'AB2',placa:'ABC1D23',qt:100,preco:6,total:600},
  {...s.abastecimentos[1],id:'AB3',placa:'DEF4G56',qt:100,preco:6,total:600}
 ];
 m.itens=['AB1','AB2','AB3'];m.notasFiscais=[{...m.notasFiscais[0],valorTotal:1800,abastecimentoIds:m.itens}];
 return {s,m};
}
test('consolidated RC preserves operational data and groups duplicate cost centers with exact 100%',async()=>{
 const {s,m}=allocationFixture(),before=JSON.stringify({s,m});
 const r=api.createBatch(s,[m],allocationOptions);
 assert.deepEqual([...r.errors],[]);assert.equal(r.rows.length,1);assert.equal(r.rows[0][3],300);assert.equal(r.rows[0][4],6);
 assert.equal(r.allocations[0].allocations.length,2);
 assert.equal(r.allocations[0].allocations.reduce((v,a)=>v+Math.round(a.percent*100),0),10000);
 assert.equal(r.allocations[0].allocations.reduce((v,a)=>v+Math.round(a.value*100),0),180000);
 assert.equal(r.items.length,3);assert.ok(r.items.every(i=>i.rowIndex===1));
 assert.equal(JSON.stringify({s,m}),before);
 const xml=new TextDecoder().decode(await r.blob.arrayBuffer());
 assert.match(xml,/sheet name="Rateio"/);assert.match(xml,/sheet2.xml/);assert.match(xml,/Quantidade Rateada/);
 assert.match(xml,/Centro de Custo/);assert.match(xml,/r="A3"[^>]*t="inlineStr"><is><t>001/);
});
test('materials have independent allocation blocks, fiscal values and compatible SAP grouping',()=>{
 const {s,m}=allocationFixture();
 s.produtos.push({id:'P2',sap:'222'});s.acordos.push({...s.acordos[0],id:'A2',produtoId:'P2'});
 for(const field of ['rcSapContasContabeis','rcSapCategoriasContabeis','rcSapGruposCompradores'])s.config.params[field]['222']=s.config.params[field]['35012674'];
 s.abastecimentos[2].produtoId='P2';s.abastecimentos[2].preco=4;s.abastecimentos[2].total=400;
 m.notasFiscais[0].valorTotal=1500;m.notasFiscais[0].itensFiscais=[{produtoDirectFuelId:'P1',valorTotal:1100},{produtoDirectFuelId:'P2',valorTotal:400}];
 const r=api.createBatch(s,[m],allocationOptions);assert.deepEqual([...r.errors],[]);assert.equal(r.rows.length,2);
 assert.deepEqual([...r.allocations].map(b=>b.value),[400,1100]);
 assert.ok(r.allocations.every(b=>b.allocations.length===1&&b.allocations[0].percent===100));
 assert.equal(r.items.find(i=>i.fuelingId==='AB1').rowIndex,2);
});
test('consolidation fails safely for missing fleet CC and ambiguous NF',()=>{
 const {s,m}=allocationFixture();s.frota=[];assert.ok(api.create(s,m,allocationOptions).errors.length);
 const fixture=allocationFixture();fixture.m.notasFiscais.push({...fixture.m.notasFiscais[0],numero:'other'});
 assert.ok(api.create(fixture.s,fixture.m,allocationOptions).errors.length);
});
test('RC rounds actual exported prices to three decimals and preserves fiscal allocation',async()=>{
 const {s,m}=allocationFixture();m.notasFiscais[0].valorTotal=1800.17;
 const before=JSON.stringify({s,m}),r=api.create(s,m,allocationOptions);
 assert.deepEqual([...r.errors],[]);assert.equal(r.rows[0][4],6.001);
 assert.equal(r.allocations[0].value,1800.17);assert.equal(r.allocations[0].rcValue,1800.3);
 assert.equal(r.allocations[0].roundingDifference,0.13);
 assert.equal(r.allocations[0].allocations.reduce((v,a)=>v+Math.round(a.value*100),0),180017);
 assert.equal(JSON.stringify({s,m}),before);
 const xml=new TextDecoder().decode(await r.blob.arrayBuffer());
 assert.match(xml,/r="E3" s="4" t="n"><v>6.001/);
 assert.match(xml,/Diferença de arredondamento/);
 s.abastecimentos[0].preco=6.1236;
 const detail=api.buildRows(s,m,{centroCustoOrigem:'transitorio'});
 assert.equal(detail.rows[0][4],6.124);
});

test('allocation rounds to one decimal then corrects largest share and exports plain numeric percentages', async()=>{
 const {s,m}=allocationFixture();s.abastecimentos[0].total=5;s.abastecimentos[1].total=5.05;s.abastecimentos[2].total=89.95;
 const r=api.create(s,m,allocationOptions);
 assert.deepEqual([...r.errors],[]);
 assert.deepEqual([...r.allocations[0].allocations].map(a=>a.percent),[10.1,89.9]);
 assert.equal(r.rows[0][10],'Rateio');assert.ok(r.items.every(i=>i.rcCostCenter==='Rateio'));
 const xml=new TextDecoder().decode(await r.blob.arrayBuffer());
 assert.match(xml,/r="K3"[^>]*><is><t>Rateio/);
 assert.match(xml,/r="C3" s="9" t="n"><v>10.1<\/v>/);
 assert.match(xml,/r="C4" s="9" t="n"><v>89.9<\/v>/);
 assert.match(xml,/r="C5" s="9" t="n"><v>100<\/v>/);
 assert.match(xml,/numFmtId="167" formatCode="0.0"/);
 assert.doesNotMatch(xml,/numFmtId="10"/);
});
test('rounding deficit goes to largest share, ties stable, each material closes independently',()=>{
 const {s,m}=allocationFixture();s.frota.push({placa:'GHI7J89',centroCusto:'003'});s.abastecimentos[1].placa='GHI7J89';
 const r=api.create(s,m,allocationOptions);
 assert.deepEqual([...r.errors],[]);
 assert.deepEqual([...r.allocations[0].allocations].map(a=>a.percent),[33.4,33.3,33.3]);
 assert.equal(r.allocations[0].allocations.reduce((sum,a)=>sum+Math.round(a.percent*10),0),1000);
});
test('unrepresentable allocation blocks RC and identifies material',()=>{
 const {s,m}=allocationFixture();s.abastecimentos=[];s.frota=[];
 // 2000 equal shares round to 0.1 each; correcting the largest would be negative.
 for(let i=0;i<2000;i++) { const placa=`PL${i}`;s.frota.push({placa,centroCusto:String(1000+i)});s.abastecimentos.push({...state.abastecimentos[0],id:`AB${i}`,placa,qt:1,preco:1,total:1}); }
 m.itens=s.abastecimentos.map(a=>a.id);m.notasFiscais[0].abastecimentoIds=m.itens;m.notasFiscais[0].valorTotal=2000;
 const r=api.create(s,m,allocationOptions);assert.equal(r.blob,undefined);
 assert.ok(r.errors.some(e=>e.includes('35012674')&&e.includes('rateio inconsistente')));
});


test("RC derives payment from each dated agreement and ignores the global default", async () => {
  const custom=structuredClone(state);
  custom.acordos[0].fim="2026-09-01";
  custom.acordos.push({...custom.acordos[0],id:"A2",numero:"AC-2",inicio:"2026-09-02",fim:"",condicaoPagamento:"Depósito em conta"});
  for (const mode of ['transitorio','frota','rateio']) {
    custom.frota=[{placa:'ABC1234',centroCusto:'123'}];
    custom.abastecimentos.forEach(a=>a.placa='ABC1234');
    const measurement=structuredClone(approved);
    measurement.notasFiscais.forEach(n=>n.valorTotal=100);
    const result=api.createBatch(custom,[measurement],{centroCustoOrigem:mode});
    assert.deepEqual([...result.errors],[]);
    assert.deepEqual(result.rows.map(r=>r[14]).join(','),'B,T');
    const xml=new TextDecoder().decode(await result.blob.arrayBuffer());
    assert.match(xml, /r="O3"[^>]*><is><t>B<\/t>/);
    assert.match(xml, /r="O4"[^>]*><is><t>T<\/t>/);
  }
  custom.acordos[1].condicaoPagamento='Depósito';
  assert.equal(api.buildRows(custom,approved).rows[1][14],'T');
});

test("RC refuses missing or unsupported agreement payment even with global B configured", () => {
  for (const payment of ['', 'PIX']) {
    const custom=structuredClone(state);
    custom.acordos[0].condicaoPagamento=payment;
    const result=api.create(custom,approved);
    assert.equal(result.blob,undefined);
    assert.ok(result.errors.some(e=>e.includes('forma de pagamento do acordo AC-1')));
  }
});
