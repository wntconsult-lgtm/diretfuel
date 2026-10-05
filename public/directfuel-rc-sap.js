(() => {
  const list = value => Array.isArray(value) ? value : [];
  const text = value => String(value ?? "").trim();
  const escapeXml = value => text(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
  const dueDate = note => [note?.vencimento, ...list(note?.parcelas).map(item => item.vencimento)].map(value => text(value).slice(0, 10)).filter(Boolean).sort()[0] || "";

  function invoiceFor(measurement, fueling) {
    const notes = list(measurement.notasFiscais);
    const linked = notes.find(note => list(note.abastecimentoIds).map(String).includes(String(fueling.id)));
    if (linked) return linked;
    if (notes.length === 1) return notes[0];
    if (measurement.nf || measurement.serie) return { numero: measurement.nf, serie: measurement.serie, emissao: measurement.emissao, vencimento: measurement.vencimento };
    return null;
  }

  const accountsFor = state => ({ ...(state?.config?.params?.rcSapContasContabeis || {}) });
  const plateKey = value => text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const sapPrice = value => Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;

  const dateKey = value => { const raw=text(value).slice(0,10),m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/),v=m?`${m[3]}-${m[2]}-${m[1]}`:raw; return /^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v?v:''; };
  function ivaFor(state, measurement, fueling) {
    const day=dateKey(fueling.data),stationId=text(fueling.postoId||measurement.postoId);
    const matches=list(state.acordos).filter(a=>day&&stationId===text(measurement.postoId)&&text(a.postoId)===stationId&&text(a.produtoId)===text(fueling.produtoId)&&dateKey(a.inicio)&&dateKey(a.inicio)<=day&&(!a.fim||(dateKey(a.fim)&&dateKey(a.fim)>=day)));
    const agreement=matches.length===1?matches[0]:null,iva=text(agreement?.ivaSap).toUpperCase();
    const error=!day?'Data do abastecimento inválida':!agreement?'Não existe um único acordo para posto/produto na data':! /^[A-Z0-9]{2}$/.test(iva)?`Configure o IVA SAP no acordo ${agreement.numero||agreement.id}`:!list(state.config?.params?.ivaSapCodigos).includes(iva)?`Cadastre o IVA ${iva} em Configurações`:'';
    const paymentName=text(agreement?.condicaoPagamento).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
    const payment=paymentName==='boleto'?'B':['deposito','deposito em conta'].includes(paymentName)?'T':'';
    const paymentError=!agreement?'Não existe um único acordo para definir a forma de pagamento':!payment?`Configure a forma de pagamento do acordo ${agreement.numero||agreement.id}: Boleto ou Depósito em conta`:'';
    return {payment,paymentError,iva,agreementId:agreement?.id||'',agreementNumber:agreement?.numero||'',error};
  }
  const snapshotFor = (measurement, fuelingId) => list(measurement?.historico).filter(h=>h.acao==='RC SAP gerada').flatMap(h=>list(h.rcItems)).find(item=>text(item.fuelingId)===text(fuelingId));

  function buildRows(state, measurement, options = {}) {
    if (options.centroCustoOrigem === "rateio") return consolidatedRows(state, measurement);
    const errors = [], items = [];
    const mode = options.centroCustoOrigem || "transitorio", accounts = accountsFor(state), params = state?.config?.params || {};
    if (!["frota", "transitorio"].includes(mode)) errors.push("Escolha a origem do centro de custo: Frota ou Transitório.");
    if (!measurement || measurement.status !== "Aprovada") errors.push("A RC SAP somente pode ser gerada para uma medição aprovada.");
    const selected = new Set(list(measurement?.itens).map(String));
    const fuelings = list(state?.abastecimentos).filter(item => selected.has(String(item.id)));
    if (!fuelings.length) errors.push("A medição não possui abastecimentos vinculados.");
    const station = list(state?.postos).find(item => String(item.id) === String(measurement?.postoId));
    if (!text(station?.sap)) errors.push("Informe o Código SAP fornecedor no cadastro do posto.");
    const output = fuelings.map(fueling => {
      const tax=ivaFor(state,measurement,fueling);
      if(tax.error)errors.push(`${fueling.id}: ${tax.error}.`);
      const product = list(state?.produtos).find(item => String(item.id) === String(fueling.produtoId));
      const unit = list(state?.unidades).find(item => String(item.id) === String(fueling.unidadeId || (list(measurement?.unidadeIds).length === 1 ? measurement.unidadeIds[0] : "")));
      const account = text(accounts[text(product?.sap)]), category = text(params.rcSapCategoriasContabeis?.[text(product?.sap)]), buyerGroup = text(params.rcSapGruposCompradores?.[text(product?.sap)]), payment = tax.payment;
      if (!category) errors.push(`${fueling.id}: configure a Categoria Contábil do SAP ${text(product?.sap)}.`);
      if (!buyerGroup) errors.push(`${fueling.id}: configure o Grupo Comprador do SAP ${text(product?.sap)}.`);
      if (tax.paymentError) errors.push(`${fueling.id}: ${tax.paymentError}.`);
      if (!text(unit?.depositoSap)) errors.push(`${fueling.id}: informe o Depósito SAP no cadastro da unidade Vixpar.`);
      const vehicles = list(state?.frota).filter(item => plateKey(fueling.placa) && plateKey(item.placa) === plateKey(fueling.placa));
      const costCenter = mode === "transitorio" ? text(params.rcSapCentroCustoTransitorio) : vehicles.length === 1 ? text(vehicles[0].centroCusto) : "";
      if (!/^\d+$/.test(account)) errors.push(`${fueling.id}: configure a Conta Contábil do código SAP ${text(product?.sap)} em Configurações → Conciliação fiscal da medição.`);
      if (mode === "transitorio" && !/^\d+$/.test(costCenter)) errors.push("Configure o Centro de Custo Transitório SAP em Conciliação fiscal da medição.");
      if (mode === "frota" && !/^\d+$/.test(costCenter)) errors.push(`${fueling.id}: informe um Centro de Custo SAP numérico no cadastro da Frota para a placa ${text(fueling.placa) || "não informada"}; deve haver um único veículo correspondente.`);
      const note = invoiceFor(measurement, fueling);
      const number = text(note?.numero), series = text(note?.serie);
      const emission = text(note?.emissao || note?.dataEmissao).slice(0, 10), expiration = dueDate(note);
      if (!text(product?.sap)) errors.push(`${fueling.id}: produto sem Código SAP no cadastro DirectFuel.`);
      if (!text(unit?.centroSap)) errors.push(`${fueling.id}: unidade Vixpar sem Centro SAP.`);
      if (!note) errors.push(`${fueling.id}: nenhuma NF vinculada.`);
      else {
        if (!number) errors.push(`${fueling.id}: número da NF não informado.`);
        if (!series) errors.push(`${fueling.id}: série da NF não informada.`);
        if (!emission) errors.push(`${fueling.id}: data de emissão da NF não informada.`);
        if (!expiration) errors.push(`${fueling.id}: data de vencimento da NF não informada.`);
      }
      if (!(Number(fueling.qt) > 0)) errors.push(`${fueling.id}: quantidade inválida.`);
      if (!(Number(fueling.preco) > 0)) errors.push(`${fueling.id}: preço unitário inválido.`);
      items.push({fuelingId:fueling.id,measurementId:measurement.id,stationId:measurement.postoId,productId:fueling.produtoId,material:text(product?.sap),iva:tax.iva,agreementId:tax.agreementId,agreementNumber:tax.agreementNumber,invoice:number&&series?`${number}-${series}`:'',rowIndex:items.length+1});
      return [category, text(product?.sap), buyerGroup, Number(fueling.qt || 0), Number(fueling.preco || 0), text(unit?.centroSap), text(unit?.depositoSap), text(station?.sap), "", account, costCenter, "", number && series ? `${number}-${series}` : "", emission, payment, expiration, tax.iva];
    });
    output.forEach(row => { row[4] = sapPrice(row[4]); });
    return { rows: output, items, errors: [...new Set(errors)] };
  }

  // Integer allocation closes money (cents) and percentages (basis points)
  // independently, without changing the operational fueling records.
  function distribute(total, weights) {
    const sum = weights.reduce((a,b)=>a+b,0);
    const raw = weights.map(w=>total*w/sum), result = raw.map(Math.floor);
    let remaining = total-result.reduce((a,b)=>a+b,0);
    const order = raw.map((n,i)=>({i,remainder:n-result[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
    for (const entry of order) { if (remaining-- <= 0) break; result[entry.i]++; }
    return result;
  }

  // Round each percentage first, then apply the entire residual to the largest share.
  // Integer tenths make the final 100.0 check independent of floating-point sums.
  function percentageTenths(weights) {
    const sum = weights.reduce((a,b)=>a+b,0);
    if (!weights.length || !Number.isFinite(sum) || sum <= 0 || weights.some(w=>!Number.isFinite(w)||w<=0)) return null;
    const raw = weights.map(w=>w/sum*1000);
    const rounded = raw.map(n=>Math.round(n + Number.EPSILON * Math.max(1, Math.abs(n)) * 4));
    const largest = weights.reduce((best,w,i)=>w>weights[best]?i:best,0);
    rounded[largest] += 1000-rounded.reduce((a,b)=>a+b,0);
    return rounded.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1000) && rounded.reduce((a,b)=>a+b,0)===1000 ? rounded : null;
  }

  function consolidatedRows(state, measurement) {
    const base = buildRows(state, measurement, {centroCustoOrigem:'transitorio'});
    const errors = [...base.errors], rows = [], items = [], allocations = [];
    const fuelings = new Map(list(state.abastecimentos).map(f=>[String(f.id),f]));
    if(list(measurement?.itens).some(id=>!fuelings.has(String(id))))errors.push('Há abastecimento da medição não encontrado. Recarregue antes de gerar.');
    const invoices = new Map();
    for (let i=0;i<base.items.length;i++) {
      const item=base.items[i],fueling=fuelings.get(String(item.fuelingId)),row=base.rows[i];
      const matches=list(measurement.notasFiscais).filter(n=>list(n.abastecimentoIds).map(String).includes(String(fueling.id)));
      if(list(measurement.notasFiscais).length>1&&matches.length!==1){errors.push(`${fueling.id}: selecione um vínculo único com a NF antes de consolidar.`);continue;}
      if(matches.length>1) {errors.push(`${fueling.id}: abastecimento vinculado a mais de uma NF.`);continue;}
      const note=invoiceFor(measurement,fueling);
      if(!note) continue;
      const key=text(note.chave||note.chaveNfe)||`${row[7]}|${row[12]}|${row[13]}`;
      if(!invoices.has(key))invoices.set(key,{note,entries:[]});
      const vehicles=list(state.frota).filter(v=>plateKey(v.placa)&&plateKey(v.placa)===plateKey(fueling.placa));
      const costCenter=vehicles.length===1?text(vehicles[0].centroCusto):'';
      if(!/^\d+$/.test(costCenter))errors.push(`${fueling.id}: informe um único Centro de Custo no cadastro da Frota para a placa ${text(fueling.placa)}.`);
      const value=Number(fueling.total??Number(fueling.qt)*Number(fueling.preco));
      if(!Number.isFinite(value)||value<=0)errors.push(`${fueling.id}: valor inválido para rateio.`);
      invoices.get(key).entries.push({item,fueling,row,costCenter,value});
    }
    if(errors.length)return {rows,items,allocations,errors:[...new Set(errors)]};
    for(const {note,entries} of invoices.values()) {
      if(list(note.abastecimentoIds).some(id=>!entries.some(e=>String(e.fueling.id)===String(id)))){errors.push(`NF ${entries[0].row[12]}: vínculo incompleto de abastecimentos.`);continue;}
      const total=Number(note.valorTotal??note.valor);
      if(!Number.isFinite(total)||total<=0){errors.push(`NF ${entries[0].row[12]}: informe o valor total da NF para consolidar.`);continue;}
      const groups=new Map();
      entries.forEach(e=>{
        const key=JSON.stringify([0,1,2,5,6,7,9,13,14,15,16].map(i=>e.row[i]));
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(e);
      });
      // Preserve fiscal material values when supplied. A global discount/difference
      // is distributed proportionally over those bases, never over unrelated NFs.
      const materialWeights=new Map();
      for(const fiscal of list(note.itensFiscais)) {
        const product=list(state.produtos).find(p=>String(p.id)===String(fiscal.produtoDirectFuelId));
        const material=text(product?.sap),value=Number(fiscal.valorTotal);
        if(!material||!Number.isFinite(value)||value<0){errors.push(`NF ${entries[0].row[12]}: item fiscal sem material/valor válido.`);continue;}
        if(!entries.some(e=>e.row[1]===material)){errors.push(`NF ${entries[0].row[12]}: material fiscal sem abastecimento vinculado.`);continue;}
        materialWeights.set(material,(materialWeights.get(material)||0)+value);
      }
      const grouped=[...groups.values()].sort((a,b)=>a[0].row[1].localeCompare(b[0].row[1]));
      const weights=grouped.map(group=>{
        const material=group[0].row[1],baseValue=group.reduce((s,e)=>s+e.value,0);
        if(materialWeights.size&&!materialWeights.has(material))errors.push(`NF ${group[0].row[12]}: falta valor fiscal do material ${material}.`);
        const materialBase=entries.filter(e=>e.row[1]===material).reduce((s,e)=>s+e.value,0);
        return materialWeights.size?(materialWeights.get(material)||0)*baseValue/materialBase:baseValue;
      });
      if(weights.some(w=>!Number.isFinite(w)||w<=0)){errors.push(`NF ${entries[0].row[12]}: base de rateio inválida.`);continue;}
      const cents=distribute(Math.round(total*100),weights);
      grouped.forEach((group,g)=>{
        const row=[...group[0].row],quantity=group.reduce((s,e)=>s+Number(e.fueling.qt),0),value=cents[g]/100;
        const price=sapPrice(value/quantity);
        const rcValue=Math.round(quantity*price*100)/100;
        const roundingDifference=(Math.round(rcValue*100)-cents[g])/100;
        if(!(price>0))errors.push(`NF ${row[12]}, material ${row[1]}: preço arredondado para 3 casas deve ser maior que zero.`);
        row[3]=quantity;row[4]=price;row[10]="Rateio";rows.push(row);
        const byCenter=new Map();
        group.forEach(e=>{if(!byCenter.has(e.costCenter))byCenter.set(e.costCenter,[]);byCenter.get(e.costCenter).push(e);});
        const centers=[...byCenter.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
        const centerWeights=centers.map(([,es])=>es.reduce((s,e)=>s+e.value,0));
        const percents=percentageTenths(centerWeights);
        if (!percents) { errors.push(`NF ${row[12]}, material ${row[1]}, item RC ${rows.length}: rateio inconsistente; não foi possível fechar em 100,0 com uma casa decimal.`); return; }
        const amounts=distribute(cents[g],centerWeights);
        const block={measurementId:measurement.id,measurementNumber:measurement.numero||measurement.id,invoice:row[12],material:row[1],account:row[9],rowIndex:rows.length,value,quantity,allocations:centers.map(([costCenter,es],c)=>({costCenter,percent:percents[c]/10,value:amounts[c]/100,quantity:es.reduce((s,e)=>s+Number(e.fueling.qt),0),fuelingIds:es.map(e=>e.fueling.id)}))};
        allocations.push(block);
        Object.assign(block,{rcValue,rcPrice:price,roundingDifference});
        group.forEach(e=>items.push({...e.item,rowIndex:rows.length,costCenter:e.costCenter,account:row[9],plate:e.fueling.placa,quantity:Number(e.fueling.qt),originalValue:e.value,fiscalValue:value,rcValue,roundingDifference,rcQuantity:quantity,rcPrice:price,rcCostCenter:row[10]}));
      });
    }
    return {rows,items,allocations,errors:[...new Set(errors)]};
  }

  const encoder = new TextEncoder();
  const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let crc = n; for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; table[n] = crc >>> 0; } return table; })();
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
  const concat = parts => { const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; };
  const header = (size, write) => { const bytes = new Uint8Array(size); write(new DataView(bytes.buffer)); return bytes; };

  function zip(files) {
    const local = [], central = []; let offset = 0, centralSize = 0;
    for (const [name, body] of files) {
      const nameBytes = encoder.encode(name), data = encoder.encode(body), crc = crc32(data);
      const localHeader = header(30, view => { view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, nameBytes.length, true); });
      local.push(localHeader, nameBytes, data);
      const centralHeader = header(46, view => { view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint32(16, crc, true); view.setUint32(20, data.length, true); view.setUint32(24, data.length, true); view.setUint16(28, nameBytes.length, true); view.setUint32(42, offset, true); });
      central.push(centralHeader, nameBytes); offset += localHeader.length + nameBytes.length + data.length; centralSize += centralHeader.length + nameBytes.length;
    }
    const end = header(22, view => { view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true); });
    return concat([...local, ...central, end]);
  }

  const excelDate = value => Math.floor((Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);
  const cell = (column, row, value, style = 0, type = "inlineStr") => value === "" || value === null || value === undefined ? "" : type === "n" ? `<c r="${column}${row}" s="${style}" t="n"><v>${Number(value)}</v></c>` : `<c r="${column}${row}" s="${style}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;

  function workbookBlob(dataRows, allocations = []) {
    const headers = ["CATEGORIA CIC", "Material", "Grupo Comprador", "Quantidade", "Preço", "Centro", "Depósito", "Fornecedor", "", "Conta Razão", "Centro de Custo", "", "Número da NF", "Data Emissão NF", "Forma de Pg", "Data Vencimento NF", "IVA SAP"];
    const columns = "ABCDEFGHIJKLMNOPQ".split("");
    const headerCells = headers.map((value, index) => cell(columns[index], 2, value, index === 15 ? 2 : 1)).join("");
    const dataCells = dataRows.map((values, index) => {
      const row = index + 3;
      return `<row r="${row}">${values.map((value, column) => {
        if ([3, 4].includes(column)) return cell(columns[column], row, value, 4, "n");
        if ([13, 15].includes(column)) return value ? cell(columns[column], row, excelDate(value), 7, "n") : "";
        return cell(columns[column], row, value, 3);
      }).join("")}</row>`;
    }).join("");
    const widths = [18, 14, 20, 14, 14, 12, 12, 15, 3, 15, 18, 3, 18, 20, 15, 23, 12];
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData><row r="2" ht="22" customHeight="1">${headerCells}</row>${dataCells}</sheetData><autoFilter ref="A2:Q${Math.max(3, dataRows.length + 2)}"/></worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="0.000"/><numFmt numFmtId="165" formatCode="0.0000"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="12"/><name val="Arial Narrow"/></font><font><b/><sz val="12"/><name val="Arial Narrow"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color auto="1"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const files = [
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Planilha1" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ["xl/worksheets/sheet1.xml", sheet], ["xl/styles.xml", styles]
    ];
    if (allocations.length) {
      const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
      let index = 1;
      const sheetRows = [];
      const add = (values, heading = false) => { const row = index++; sheetRows.push(`<row r="${row}">${values.map((value, column) => cell('ABCDEF'[column], row, value, heading ? 1 : column === 2 ? 9 : column === 3 ? 8 : column === 4 ? 4 : 3, !heading && typeof value === 'number' ? 'n' : 'inlineStr')).join('')}</row>`); };
      for (const block of allocations) {
        add([`NF ${block.invoice} · ${block.measurementNumber} · Material ${block.material} · Item RC ${block.rowIndex}`], true);
        if(block.roundingDifference) add([`Preço RC: ${block.rcPrice.toFixed(3)} · Total RC: ${block.rcValue.toFixed(2)} · Total fiscal: ${block.value.toFixed(2)} · Diferença de arredondamento (RC − fiscal): ${block.roundingDifference.toFixed(2)}`], true);
        add(['Centro de Custo','Conta Contábil','Percentual','Valor Rateado','Quantidade Rateada','Material SAP'], true);
        block.allocations.forEach(a => add([a.costCenter,block.account,a.percent,a.value,a.quantity,block.material]));
        add(['Total do material','',100,block.value,block.quantity,'']);
        index++;
      }
      files[0][1] = files[0][1].replace('</Types>', '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
      files[2][1] = files[2][1].replace('</sheets>', '<sheet name="Rateio" sheetId="2" r:id="rId3"/></sheets>');
      files[3][1] = files[3][1].replace('</Relationships>', '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
      files[5][1] = files[5][1].replace('<numFmts count="3">', '<numFmts count="4">').replace('</numFmts>', '<numFmt numFmtId="167" formatCode="0.0"/></numFmts>').replace('<cellXfs count="8">','<cellXfs count="10">').replace('</cellXfs>','<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>');
      files.push(['xl/worksheets/sheet2.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${namespace}"><cols>${[24,24,18,22,24,22].map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows.join('')}</sheetData></worksheet>`]);
    }
    return new Blob([zip(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function create(state, measurement, options = {}) {
    const built = buildRows(state, measurement, options);
    if (built.errors.length) return built;
    const safe = text(measurement.numero || measurement.id || "medicao").replace(/[^a-z0-9_-]+/gi, "_");
    return { ...built, blob: workbookBlob(built.rows, built.allocations), filename: `RC_SAP_${safe}.xlsx` };
  }

  function createBatch(state, measurements, options = {}) {
    const selected = list(measurements).filter(Boolean), rows = [], errors = [], items = [], allocations = [];
    if (!selected.length) return { rows, errors: ["Selecione ao menos uma medição aprovada."] };
    selected.forEach(measurement => {
      const built = buildRows(state, measurement, options), label = text(measurement.numero || measurement.id || "Medição");
      items.push(...built.items.map(item=>({...item,rowIndex:rows.length+item.rowIndex})));
      allocations.push(...list(built.allocations).map(block=>({...block,rowIndex:rows.length+block.rowIndex})));
      rows.push(...built.rows);
      errors.push(...built.errors.map(error => `${label}: ${error}`));
    });
    if (errors.length) return { rows, errors: [...new Set(errors)] };
    return { rows, errors, items, allocations, blob: workbookBlob(rows, allocations), filename: `RC_SAP_LOTE_${selected.length}_MEDICOES.xlsx` };
  }

  window.DirectFuelRcSap = { accountsFor, ivaFor, snapshotFor, buildRows, workbookBlob, create, createBatch };
})();
