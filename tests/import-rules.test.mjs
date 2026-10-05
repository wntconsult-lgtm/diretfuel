import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const window={};vm.runInNewContext(readFileSync(new URL('../public/directfuel-import-rules.js',import.meta.url),'utf8'),{window});
const r=window.DirectFuelImportRules;
test('Gekon CSV accepts blank report columns without Id Posto',()=>{
 const result=r.parseCsv('Data;Posto;;;Veículo;Motorista;Empresa;Produto;Quantidade\n11/09/2026 15:06;Nome Gekon;;;[ABC1D23];Motorista;Empresa;Arla;56.29');
 assert.equal(result.records.length,1);assert.equal(result.records[0].produto,'Arla');
});
test('Gekon station aliases resolve exactly and never guess an unmapped name',()=>{
 const stations=[{id:'S1',gekonNames:['POSTO GEKON - ES']}];
 assert.equal(r.resolveStation({_gekon:true,posto:'Posto Gekon - ES'},stations).station.id,'S1');
 assert.ok(r.resolveStation({_gekon:true,posto:'Posto'},stations).error);
 assert.ok(r.resolveStation({_gekon:true,posto:'Posto Gekon - ES'},[...stations,{id:'S2',gekonNames:['POSTO GEKON - ES']}]).error);
});
test('Gekon product mapping uses historical validity and blocks ambiguous or canceled agreements',()=>{
 const products=[{id:'D'},{id:'A'}],a={id:'A1',postoId:'S1',produtoId:'D',inicio:'2026-01-01',fim:'2026-09-30',status:'Encerrado',gekonProducts:['Diesel S10']};
 assert.equal(r.resolveGekonProduct('Diesel S10','S1','2026-09-11',[a],products).product.id,'D');
 assert.ok(r.resolveGekonProduct('Diesel S10','S1','2026-10-01',[a],products).error);
 assert.ok(r.resolveGekonProduct('Diesel S10','S1','2026-09-11',[a,{...a,id:'A2',produtoId:'A'}],products).error);
 assert.ok(r.resolveGekonProduct('Diesel S10','S1','2026-09-11',[{...a,status:'Cancelado'}],products).error);
});
const stations=[
 {id:'S1',codigo:'PST-0001',fantasia:'Posto Roma',cnpj:'11.111.111/0001-11',endereco:'BR 262 KM 116',municipio:'Rio Casca',uf:'MG',cep:'35370000'},
 {id:'S2',codigo:'PST-0002',fantasia:'Posto Roma',cnpj:'22.222.222/0001-22',endereco:'Av Brasil 50',municipio:'Formiga',uf:'MG',cep:'35570000'}
];

test('exact authorization model parses with Id Posto',()=>{const csv=readFileSync(new URL('../public/modelo_importacao_abastecimentos_directfuel.csv',import.meta.url),'utf8');const parsed=r.parseCsv(csv);assert.deepEqual([...parsed.headers],['data','posto','veiculo','motorista','empresa','produto','quantidade','id_posto']);assert.equal(parsed.records.length,1);assert.equal(parsed.records[0].id_posto,'PST-0001');assert.equal(r.resolveStation(parsed.records[0],stations).station.id,'S1');});
test('CNPJ identifies the correct station despite duplicate names',()=>assert.equal(r.resolveStation({posto:'Posto Roma',cnpj_posto:'22.222.222/0001-22'},stations).station.id,'S2'));
test('duplicate name without discriminator is blocked',()=>assert.match(r.resolveStation({posto:'Posto Roma'},stations).error,/ambíguo/));
test('municipality disambiguates duplicate names',()=>assert.equal(r.resolveStation({posto:'Posto Roma',municipio_posto:'Formiga',uf_posto:'MG'},stations).station.id,'S2'));
test('address disambiguates duplicate names',()=>assert.equal(r.resolveStation({posto:'Posto Roma',endereco_posto:'Rodovia BR 262 KM 116'},stations).station.id,'S1'));
test('expired agreement is used when fueling date is within validity',()=>{const agreements=[{id:'A1',postoId:'S1',produtoId:'D',inicio:'2026-01-01',fim:'2026-03-31',status:'Encerrado',preco:5.6}];assert.equal(r.findAgreement(agreements,'S1','D','2026-02-15').id,'A1');assert.equal(r.findAgreement(agreements,'S1','D','2026-04-01'),undefined);});
test('agreement price replaces imported price and recalculates total',()=>{const applied=r.applyAgreementPrice(100,5.9,590,{preco:5.6});assert.equal(applied.price,5.6);assert.equal(applied.total,560);assert.equal(applied.source,'Acordo válido na data');assert.equal(applied.originalPrice,5.9);assert.equal(applied.originalTotal,590);});

test('Gekon capacity validation accepts the exact vehicle limit and rejects only excess',()=>{
  const vehicle={placa:'ABC1D23',capTanque:600};
  assert.equal(r.fuelingCapacityError(599.99,vehicle),'');
  assert.equal(r.fuelingCapacityError(600,vehicle),'');
  assert.match(r.fuelingCapacityError(600.01,vehicle),/Erro de capacidade: 600,01 L excede a capacidade cadastrada de 600 L para ABC1D23/);
});

test('Gekon capacity validation blocks a vehicle without registered capacity',()=>{
  assert.match(r.fuelingCapacityError(100,{placa:'SEM1CAP',capTanque:0}),/Capacidade do veículo não cadastrada: SEM1CAP/);
});

test('agreement status follows its validity dates',()=>{
  assert.equal(r.effectiveAgreementStatus({inicio:'2026-10-01',fim:'2026-12-31',status:'Vigente'},'2026-09-10'),'Futuro');
  assert.equal(r.effectiveAgreementStatus({inicio:'2026-01-01',fim:'2026-09-10',status:'Vigente'},'2026-09-10'),'Vigente');
  assert.equal(r.effectiveAgreementStatus({inicio:'2026-01-01',fim:'2026-09-09',status:'Vigente'},'2026-09-10'),'Encerrado');
});
test('manual agreement statuses take precedence over dates',()=>{
  assert.equal(r.effectiveAgreementStatus({inicio:'2026-01-01',fim:'2026-12-31',status:'Encerrado'},'2026-09-10'),'Encerrado');
  assert.equal(r.effectiveAgreementStatus({inicio:'2026-01-01',fim:'2026-12-31',status:'Cancelado'},'2026-09-10'),'Cancelado');
});
test('agreement without end date remains valid through 31/12/9999',()=>{
  const agreements=[{id:'A3',postoId:'S1',produtoId:'D',inicio:'2026-01-01',fim:'',status:'Vigente',preco:5.6}];
  assert.equal(r.effectiveAgreementStatus(agreements[0],'2999-12-31'),'Vigente');
  assert.equal(r.findAgreement(agreements,'S1','D','2999-12-31').id,'A3');
  assert.equal(r.isAgreementOpen(agreements[0]),true);
});
test('only current and future agreements count as open',()=>{
  assert.equal(r.isAgreementOpen({inicio:'2026-01-01',fim:'2026-09-09',status:'Vigente'}),false);
  assert.equal(r.isAgreementOpen({inicio:'2999-01-01',fim:'2999-12-31',status:'Vigente'}),true);
});
test('automatically expired agreement remains available for historical fueling',()=>{
  const agreements=[{id:'A2',postoId:'S1',produtoId:'D',inicio:'2026-01-01',fim:'2026-03-31',status:'Vigente',preco:5.6}];
  assert.equal(r.effectiveAgreementStatus(agreements[0],'2026-09-10'),'Encerrado');
  assert.equal(r.findAgreement(agreements,'S1','D','2026-02-15').id,'A2');
});
test('canceled agreement is never used for fueling',()=>{
  const agreements=[{id:'A4',postoId:'S1',produtoId:'D',inicio:'2026-01-01',fim:'2026-03-31',status:'Cancelado',preco:5.6}];
  assert.equal(r.findAgreement(agreements,'S1','D','2026-02-15'),undefined);
});
test('agreement dates cannot overlap for the same station and product',()=>{
  const agreements=[
    {id:'A1',postoId:'S1',produtoId:'D',inicio:'2026-01-01',fim:'2026-03-31',status:'Encerrado'},
    {id:'A2',postoId:'S1',produtoId:'D',inicio:'2026-04-01',fim:'',status:'Vigente'}
  ];
  assert.equal(r.agreementDateConflict({id:'A3',postoId:'S1',produtoId:'D',inicio:'2026-03-31',fim:'2026-04-15',status:'Vigente'},agreements).id,'A1');
  assert.equal(r.agreementDateConflict({id:'A3',postoId:'S1',produtoId:'D',inicio:'2025-12-01',fim:'2025-12-31',status:'Encerrado'},agreements),null);
  assert.equal(r.agreementDateConflict({id:'A3',postoId:'S1',produtoId:'A',inicio:'2026-01-01',fim:'',status:'Vigente'},agreements),null);
  assert.equal(r.agreementDateConflict({id:'A3',postoId:'S1',produtoId:'D',inicio:'2026-02-01',fim:'2026-02-28',status:'Cancelado'},agreements),null);
});
