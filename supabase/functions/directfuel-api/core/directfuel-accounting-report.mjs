// Generated from lib/directfuel-accounting-report.ts. Run node scripts/build-supabase-core.mjs.
                               
const list=(v    )      =>Array.isArray(v)?v:[];
const ids=(v    )         =>Array.isArray(v)?v.map(String):[];
const key=(n    )=>`${n.numero}-${n.serie}`.split('-').map(v=>v.trim().replace(/^0+(?=\d)/,'')).join('-');
export function accountingReport(state    , selected         ){
 const unique=[...new Set(selected)],meds=list(state.medicoes).filter(m=>unique.includes(String(m.id)));
 if(!unique.length||meds.length!==unique.length||meds.some(m=>m.status!=='Aprovada'))throw Error('Selecione medições aprovadas válidas.');
 const fuels=list(state.abastecimentos),seen=new Set        (),rows      =[],subtotals      =[];
 for(const m of meds){
  const notes=list(m.notasFiscais),links=new Set([...ids(m.itens),...notes.flatMap(n=>ids(n.abastecimentoIds)),...fuels.filter(a=>String(a.medicaoId||'')===String(m.id)).map(a=>String(a.id))]);
  let count=0,volume=0,total=0;
  for(const id of links){const a=fuels.find(a=>String(a.id)===id);if(!a)throw Error(`Abastecimento ${id} vinculado a ${m.numero} não encontrado.`);
   const other=list(state.medicoes).find(o=>String(o.id)!==String(m.id)&&o.status!=='Devolvida para pendentes'&&(ids(o.itens).includes(id)||list(o.notasFiscais).some(n=>ids(n.abastecimentoIds).includes(id))));
   if(seen.has(id)||other||(a.medicaoId&&String(a.medicaoId)!==String(m.id)))throw Error(`Vínculo conflitante do abastecimento ${id}. Confira a medição antes de exportar.`);seen.add(id);
   const station=list(state.postos).find(p=>p.id===a.postoId)||{},unit=list(state.unidades).find(u=>u.id===a.unidadeId)||{},product=list(state.produtos).find(p=>p.id===a.produtoId)||{};
   const linkedNotes=notes.filter(n=>ids(n.abastecimentoIds).includes(id));
   const agreement=list(state.acordos).find(r=>r.id===a.acordoId||(a.acordoNumeroInformado&&r.numero===a.acordoNumeroInformado));
   const postings=list(state.sapReturns).filter(r=>!r.voided&&r.status==='success'&&r.purchaseOrder&&String(r.measurementId)===String(m.id)&&linkedNotes.some(n=>key(n)===r.invoiceKey));
   const qt=Number(a.qt||0),value=Number(a.total||0);count++;volume+=qt;total+=value;
   rows.push({'Medição':m.numero||m.id,'Pedido de Compra':[...new Set(postings.map(r=>String(r.purchaseOrder)))].join(', '),'Data Lançamento NF SAP':[...new Set(postings.map(r=>String(r.postingDate||'').slice(0,10)).filter(Boolean))].join(', '),'NF':linkedNotes.map(n=>key(n)).join(', '),'Data NF':linkedNotes.map(n=>String(n.emissao||n.dataEmissao||'').slice(0,10)).join(', '),'Posto':station.fantasia||station.razao||'','ID Posto':station.codigo||station.id||a.postoId||'','CNPJ':station.cnpj||'','IVA SAP':((Array.isArray(m.historico)?m.historico:[]).filter((h    )=>h.acao==='RC SAP gerada').flatMap((h    )=>Array.isArray(h.rcItems)?h.rcItems:[]).find((item    )=>String(item.fuelingId)===id)?.iva||''),'ID Abastecimento':id,'Data abastecimento':a.data||'','Hora':a.hora||'','Placa':a.placa||'','Motorista':a.motorista||'','Filial':unit.nome||'','Centro SAP':unit.centroSap||'','Centro de custo':String(a.centroCusto||''),'Produto':product.descricao||product.curta||'','Código SAP produto':String(product.sap||''),'Quantidade em litros':qt,'Valor unitário':Number(a.preco||0),'Valor total':value,'Acordo':a.acordoNumeroInformado||agreement?.numero||a.acordoId||'','Condição de pagamento':a.condicaoPagamento||agreement?.condicaoPagamento||a.modalidadePagamento||'','Fornecedor SAP':String(station.sap||''),'Origem da carga':a.origem||a.arquivoOrigem||''});
  }
  subtotals.push({measurementId:m.id,medicao:m.numero||m.id,count,volume,total});
 }
 return {rows,subtotals,summary:{measurements:meds.length,count:rows.length,volume:subtotals.reduce((s,r)=>s+r.volume,0),total:subtotals.reduce((s,r)=>s+r.total,0)},measurementIds:unique,purchaseOrders:[...new Set(list(state.sapReturns).filter(r=>!r.voided&&r.purchaseOrder&&unique.includes(String(r.measurementId))).map(r=>String(r.purchaseOrder)))]};
}
