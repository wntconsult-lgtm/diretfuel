(() => {
  const rows=value=>Array.isArray(value)?value:[];
  const quantity=value=>Number(value || 0);
  const date=value=>String(value || "").slice(0,10);
  const targetsFor=note=>{
    const targets=new Map();
    for(const item of rows(note.itensFiscais)){
      const productId=String(item.produtoDirectFuelId || "");
      if(productId)targets.set(productId,(targets.get(productId)||0)+quantity(item.quantidade));
    }
    return targets;
  };
  function automaticLinks(notes,fuelings,tolerance=.010001){
    const allNotes=rows(notes),allFuelings=rows(fuelings),validIds=new Set(allFuelings.map(item=>String(item.id))),used=new Set(),result=new Map();
    for(const note of allNotes){
      if(!note.vinculoManual&&!note.conferenciaConfirmada)continue;
      const linked=rows(note.abastecimentoIds).map(String).filter(id=>validIds.has(id)&&!used.has(id));
      linked.forEach(id=>used.add(id));result.set(note,linked);
    }
    const ordered=allNotes.map((note,index)=>({note,index})).filter(({note})=>!result.has(note)).sort((a,b)=>date(a.note.emissao).localeCompare(date(b.note.emissao))||Number(a.note.pdfPaginaInicial||a.index)-Number(b.note.pdfPaginaInicial||b.index)||a.index-b.index);
    for(const {note} of ordered){
      const linked=[],invoiceDate=date(note.emissao);
      for(const [productId,target] of targetsFor(note)){
        const candidates=allFuelings.filter(item=>!used.has(String(item.id))&&String(item.produtoId||"")===productId&&(!invoiceDate||!date(item.data)||date(item.data)<=invoiceDate)).sort((a,b)=>date(a.data).localeCompare(date(b.data))||String(a.hora||"").localeCompare(String(b.hora||""))||String(a.id).localeCompare(String(b.id)));
        const exact=[...candidates].sort((a,b)=>Number(date(b.data)===invoiceDate)-Number(date(a.data)===invoiceDate)||date(b.data).localeCompare(date(a.data))).find(item=>Math.abs(quantity(item.qt)-target)<=tolerance);
        const selected=[];
        if(exact)selected.push(exact);
        else {let total=0;for(const item of candidates){selected.push(item);total+=quantity(item.qt);if(total>=target-tolerance)break;}}
        for(const item of selected){const id=String(item.id);if(!used.has(id)){used.add(id);linked.push(id);}}
      }
      result.set(note,linked);
    }
    return result;
  }
  window.DirectFuelReconciliation={automaticLinks,targetsFor};
})();
