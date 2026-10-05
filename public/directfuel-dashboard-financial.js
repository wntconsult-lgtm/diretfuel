(() => {
  const list = value => Array.isArray(value) ? value : [];
  const text = value => String(value ?? "").trim();
  const code = value => text(value).replace(/^0+(?=\d)/, "");
  const iso = value => {
    const raw = text(value).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{2})[/.](\d{2})[/.](\d{4})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
  };
  const invoiceKey = note => [code(note.numero), code(note.serie)].filter(Boolean).join("-");
  const localToday = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const notes = measurement => list(measurement.notasFiscais).length ? list(measurement.notasFiscais) : text(measurement.nf) ? [{numero: measurement.nf, serie: measurement.serie, emissao: measurement.emissao, vencimento: measurement.vencimento, valorTotal: measurement.valorNf}] : [];
  const dueDate = note => [note.vencimento, ...list(note.parcelas).map(item => item.vencimento)].map(iso).filter(Boolean).sort()[0] || "";

  const alertDays = state => { const value = Number(state.config?.params?.nfDueAlertDays ?? 7); return Number.isInteger(value) && value >= 0 && value <= 3650 ? value : 7; };

  function summarize(state, filters = {}) {
    const from = iso(filters.from), to = iso(filters.to), today = iso(filters.today) || localToday();
    const productIds = new Set(list(filters.productIds).map(String));
    const returns = list(state.sapReturns).filter(record => !record.voided && record.status === "success" && record.purchaseOrder && iso(record.postingDate));
    const entries = [];
    for (const measurement of list(state.medicoes)) {
      // Keep the dashboard on the same accounting basis: only approved
      // measurements are eligible for SAP posting and reconciliation.
      if (text(measurement.status) !== "Aprovada") continue;
      const measurementItems = new Set(list(measurement.itens).map(String));
      const measurementFuelings = list(state.abastecimentos).filter(fueling => measurementItems.has(String(fueling.id)) || String(fueling.medicaoId || "") === String(measurement.id));
      notes(measurement).forEach((note, noteIndex) => {
        if (!text(note.numero)) return;
        const emission = iso(note.emissao || note.dataEmissao || measurement.emissao);
        if (!emission || from && emission < from || to && emission > to) return;
        const linkedIds = new Set(list(note.abastecimentoIds).map(String));
        const linked = linkedIds.size ? measurementFuelings.filter(fueling => linkedIds.has(String(fueling.id))) : measurementFuelings;
        const dimensionMatch = fueling => (!filters.unitId || String(fueling.unidadeId || "") === String(filters.unitId)) && (!filters.stationId || String(fueling.postoId || measurement.postoId || "") === String(filters.stationId)) && (!productIds.size || productIds.has(String(fueling.produtoId || ""))) && (!filters.costCenter || String(fueling.centroCusto || "") === String(filters.costCenter));
        const stationMatch = !filters.stationId || String(measurement.postoId || linked[0]?.postoId || "") === String(filters.stationId);
        const dimensionFilters = Boolean(filters.unitId || filters.stationId || productIds.size || filters.costCenter);
        if (dimensionFilters && !(linked.some(dimensionMatch) || !linked.length && stationMatch && !filters.unitId && !productIds.size && !filters.costCenter)) return;
        const key = invoiceKey(note);
        const posted = returns.some(record => String(record.measurementId) === String(measurement.id) && String(record.invoiceKey) === key);
        const due = dueDate(note);
        const station = list(state.postos).find(item => String(item.id) === String(measurement.postoId || linked[0]?.postoId)) || {};
        const sapLinks = list(state.sapReturns).filter(record => !record.voided && record.status === "success" && String(record.measurementId) === String(measurement.id) && String(record.invoiceKey) === key);
        const days = due ? Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null;
        entries.push({station: station.fantasia || station.razao || measurement.postoId || "Sem posto", supplier: station.sap || "", value: Number(note.valorTotal ?? note.total ?? 0), measurement: measurement.numero || measurement.id, requisitions: [...new Set(sapLinks.map(record => record.requisition).filter(Boolean))].join(", "), purchaseOrders: [...new Set(sapLinks.map(record => record.purchaseOrder).filter(Boolean))].join(", "), days, id: text(note.id) || `${measurement.id}:${key}:${noteIndex}`, measurementId: measurement.id, invoiceKey: key, emission, dueDate: due, posted, missingDueDate: !due, overdue: !posted && Boolean(due && due < today)});
      });
    }
    const posted = entries.filter(item => item.posted).length;
    const overdue = entries.filter(item => item.overdue).length;
    const missingDueDate = entries.filter(item => !item.posted && item.missingDueDate).length;
    const onTime = entries.length - posted - overdue;
    return {total: entries.length, posted, overdue, onTime, missingDueDate, today, entries, alertDays: alertDays(state), pending: entries.length - posted, dueSoon: entries.filter(item => !item.posted && item.days !== null && item.days >= 0 && item.days <= alertDays(state)).length, dueLater: entries.filter(item => !item.posted && item.days > alertDays(state)).length};
  }

  window.DirectFuelDashboardFinancial = {summarize, invoiceKey, dueDate, alertDays};
})();

(() => {
  const dayMs=86400000;
  const date=value=>{const raw=String(value||'').slice(0,10),m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/),iso=m?`${m[3]}-${m[2]}-${m[1]}`:raw;const n=Date.parse(iso+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(iso)&&Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===iso?n:null;};
  const iso=n=>new Date(n).toISOString().slice(0,10);
  const params=state=>{const p=state.config?.params||{},close=Number(p.measurementWeekClose??0),delay=Number(p.measurementWeekDelay??2);return {close:Number.isInteger(close)&&close>=0&&close<=6?close:0,delay:Number.isInteger(delay)&&delay>=0&&delay<=30?delay:2};};
  function summarize(state, rows, today) {
    const p=params(state),now=new Date(),reference=today||`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`,t=date(reference),map=new Map();
    if(t===null)throw Error('Data de referência inválida');
    for(const row of rows.filter(r=>!r.medicaoId)) {
      const d=date(row.data),agreements=(state.acordos||[]).filter(a=>a.postoId===row.postoId&&a.produtoId===row.produtoId&&d!==null&&date(a.inicio)!==null&&date(a.inicio)<=d&&(!a.fim||date(a.fim)>=d));
      const linked=agreements.find(a=>a.id===(row.agreementId||row.acordoId)),agreement=linked||(agreements.length===1?agreements[0]:null);
      const close=agreement?.measurementWeekClose,delay=agreement?.measurementWeekDelay;
      const configured=Number.isInteger(close)&&close>=0&&close<=6&&Number.isInteger(delay)&&delay>=0&&delay<=30;
      const end=d===null||!configured?null:d+((close-new Date(d).getUTCDay()+7)%7)*dayMs,start=end===null?null:end-6*dayMs,due=end===null?null:end+delay*dayMs;
      const status=d===null?'invalid':d>t?'future':!configured?'unconfigured':end>=t?'current':t>due?((t-due)/dayMs>2?'critical':'late'):'ready';
      const key=JSON.stringify([row.postoId,agreement?.id||row.produtoId,end,status]);
      if(!map.has(key))map.set(key,{key,stationId:row.postoId,agreement:agreement?.numero||agreement?.id||'Sem acordo único na data',start:start===null?'':iso(start),end:end===null?'':iso(end),due:due===null?'':iso(due),status,days:['late','critical'].includes(status)?Math.round((t-due)/dayMs):0,ids:[],value:0,volume:0,count:0});
      const g=map.get(key);g.ids.push(row.id);g.value+=Number(row.total||0);g.volume+=Number(row.qt||0);g.count++;
    }
    const groups=[...map.values()].sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||String(a.stationId).localeCompare(String(b.stationId)));
    const sum=list=>({value:list.reduce((s,g)=>s+g.value,0),volume:list.reduce((s,g)=>s+g.volume,0),count:list.reduce((s,g)=>s+g.count,0),groups:list.length});
    return {groups,total:sum(groups),critical:sum(groups.filter(g=>g.status==='critical')),late:sum(groups.filter(g=>g.status==='late')),dueToday:sum(groups.filter(g=>g.status==='today')),unconfigured:sum(groups.filter(g=>g.status==='unconfigured')),ready:sum(groups.filter(g=>g.status==='ready')),current:sum(groups.filter(g=>g.status==='current')),other:sum(groups.filter(g=>['future','invalid'].includes(g.status))),oldest:groups.find(g=>['late','critical'].includes(g.status))||null,today:reference,...p};
  }
  window.DirectFuelWeeklyPending={params,summarize};
})();
