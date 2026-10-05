type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
const text = (v: unknown) => String(v ?? '').trim();
const nfKey = (v: unknown) => text(v).split('-').map(s=>s.replace(/^0+(?=\d)/,'')).join('-');
const validDate = (v: unknown) => { const s=text(v).slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s; };
export type DocumentCandidate = { id: string; type: 'pdf'|'xml'; references: {measurement: string; invoice: string; name: string; eligible: boolean}[]; eligible: boolean; reason: string };
export function completedDocumentCandidates(state: Row): DocumentCandidate[] {
  const files = new Map<string,DocumentCandidate>();
  const add = (id: string, type: 'pdf'|'xml', reference: DocumentCandidate['references'][number]) => {
    if (!id) return;
    const key=`${id}.${type}`;
    if (!files.has(key)) files.set(key,{id,type,references:[],eligible:false,reason:''});
    files.get(key)!.references.push(reference);
  };
  const returns=rows(state.sapReturns).filter(r=>!r.voided);
  for(const m of rows(state.medicoes)) {
    const notes=rows(m.notasFiscais);
    for(const n of notes) {
      const key=nfKey(`${text(n.numero)}-${text(n.serie)}`);
      const matches=returns.filter(r=>text(r.measurementId)===text(m.id)&&nfKey(r.invoiceKey)===key);
      const orders=matches.filter(r=>text(r.purchaseOrder));
      const unique=notes.filter(other=>nfKey(`${text(other.numero)}-${text(other.serie)}`)===key).length===1;
      // Require every active purchase order to be posted, and reject any active error/partial.
      const eligible=m.status==='Aprovada' && unique && !!text(n.numero) && !!text(n.serie) && orders.length>0 &&
        orders.every(r=>/^\d+$/.test(text(r.purchaseOrder))&&r.status==='success'&&validDate(r.postingDate)) &&
        matches.every(r=>r.status==='success');
      const ref={measurement:text(m.numero||m.id),invoice:key,name:text(n.pdfNome||n.xmlNome||n.arquivoNome),eligible};
      if(n.documentoPdfId||n.pdfDocumento) add(text(n.documentoPdfId||n.id),'pdf',ref);
      if(n.xmlDocumento) add(text(n.id),'xml',{...ref,name:text(n.xmlNome)});
    }
    // Legacy attachments stay protected: their invoice-level links cannot be proven.
    if(m.danfeNome) add(text(m.id),'pdf',{measurement:text(m.numero||m.id),invoice:text(m.nf),name:text(m.danfeNome),eligible:false});
  }
  // Protect references outside measured invoices (pending notes, layouts, document registry).
  const visit = (value: unknown) => {
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(!value||typeof value!=='object')return;
    const r=value as Row;
    const ref={measurement:'Referência adicional',invoice:'',name:'',eligible:false};
    if(r.documentoPdfId||r.pdfDocumento) add(text(r.documentoPdfId||r.id),'pdf',ref);
    if(r.xmlDocumento) add(text(r.id),'xml',ref);
    if(r.documentId) add(text(r.documentId),'pdf',ref);
    Object.values(r).forEach(visit);
  };
  for(const [key,value] of Object.entries(state)) if(!['medicoes','audit','sapReturns'].includes(key)) visit(value);
  for(const file of files.values()) {
    file.eligible=/^[A-Za-z0-9_-]{1,100}$/.test(file.id)&&!file.id.startsWith('NF_LAYOUT_')&&file.references.every(r=>r.eligible);
    file.reason=file.eligible?'Pedido e lançamento SAP confirmados em todas as NFs':'Preservado: pendência, referência adicional, layout ou vínculo não confirmado';
  }
  return [...files.values()];
}
