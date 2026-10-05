(() => {
  const text = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const digits = value => String(value ?? '').replace(/\D/g, '');
  const isoDate = value => {
    const raw=String(value ?? '').trim(); let m=raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    m=raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:'';
  };
  const todayIso = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  function effectiveAgreementStatus(agreement, referenceDate = todayIso()) {
    const manual=text(agreement?.status || 'Vigente');
    if(manual==='cancelado')return 'Cancelado';
    if(manual==='encerrado')return 'Encerrado';
    const date=isoDate(referenceDate) || todayIso(), start=agreement?.inicio?isoDate(agreement.inicio):'', end=agreement?.fim?isoDate(agreement.fim):'9999-12-31';
    if(start && date<start)return 'Futuro';
    if(date>end)return 'Encerrado';
    return 'Vigente';
  }
  const isAgreementOpen = agreement => ['Vigente','Futuro'].includes(effectiveAgreementStatus(agreement));
  const stationLabel = station => `${station.codigo || station.id} · ${station.fantasia || station.razao} · CNPJ ${station.cnpj || 'não informado'} · ${station.endereco || 'endereço não informado'} · ${station.municipio || ''}/${station.uf || ''}`;

  function parseCsv(sourceText) {
    const source=String(sourceText || '').replace(/^\ufeff/,'');
    const lines=source.split(/\r?\n/).slice(0,80), headerSource=lines.find(line=>/\bData\b/i.test(line) && /\bPosto\b/i.test(line) && /Produto/i.test(line));
    if(!headerSource) throw new Error('Cabeçalho não reconhecido. O arquivo deve conter Data, Posto, Produto, Quantidade.');
    const count=(line,separator)=>(line.match(new RegExp(`\\${separator}`,'g')) || []).length, delimiter=count(headerSource,';')>=count(headerSource,',')?';':',';
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<source.length;i++){const char=source[i];if(quoted){if(char==='"'&&source[i+1]==='"'){cell+='"';i++;}else if(char==='"')quoted=false;else cell+=char;}else if(char==='"')quoted=true;else if(char===delimiter){row.push(cell.trim());cell='';}else if(char==='\n'){row.push(cell.trim());rows.push(row);row=[];cell='';}else if(char!=='\r')cell+=char;}
    row.push(cell.trim());if(row.some(Boolean))rows.push(row);
    const norm=value=>text(value).replace(/\s+/g,'_'), headerIndex=rows.findIndex(values=>{const h=values.map(norm);return h.includes('data')&&h.includes('posto');}), headers=(rows[headerIndex] || []).map(norm);
    if(headerIndex<0) throw new Error('Linha de cabeçalho não encontrada.');
    for(const required of ['data','posto','veiculo','motorista','empresa','produto','quantidade']) if(!headers.includes(required)) throw new Error(`Coluna obrigatória ausente: ${required.replace(/_/g,' ')}.`);
    const records=rows.slice(headerIndex+1).map((values,index)=>{const record={_line:headerIndex+index+2};headers.forEach((header,column)=>{if(header)record[header]=values[column] ?? '';});return record;}).filter(record=>String(record.data || '').trim()&&!/^total\b/i.test(String(record.data || '').trim()));
    return {records,delimiter,headerLine:headerIndex+1,headers};
  }
  function resolveStation(row, stations) {
    const source=row || {}, list=stations || [], reference=String(source.id_posto || source.codigo_posto || source.posto_id || '').trim();
    if(reference) {
      const matches=list.filter(s=>[s.id,s.codigo,s.sap].some(v=>text(v)===text(reference)));
      return matches.length===1?{station:matches[0],method:'ID do posto',candidates:[]}:{station:null,method:'ID do posto',candidates:matches.map(stationLabel),error:matches.length?'ID duplicado no cadastro':'ID do posto não encontrado'};
    }
    const aliases=list.filter(s=>(s.gekonNames || []).some(name=>text(name)===text(source.posto)));
    if(aliases.length) return aliases.length===1?{station:aliases[0],method:'De/Para Gekon',candidates:[]}:{station:null,method:'De/Para Gekon',candidates:aliases.map(stationLabel),error:'Nome Gekon vinculado a mais de um posto'};
    if(source._gekon) return {station:null,method:'De/Para Gekon',candidates:[],error:'Cadastre o nome Gekon no posto'};
    const cnpjRaw=source.cnpj_posto || source.posto_cnpj || source.cnpj || String(source.posto || '').match(/\d[\d.\/-]{12,18}\d/)?.[0] || '', cnpj=digits(cnpjRaw);
    if(cnpj) {
      const matches=list.filter(s=>digits(s.cnpj)===cnpj);
      return matches.length===1?{station:matches[0],method:'CNPJ',candidates:[]}:{station:null,method:'CNPJ',candidates:matches.map(stationLabel),error:matches.length?'CNPJ duplicado no cadastro':'CNPJ do posto não encontrado'};
    }
    const wanted=text(source.posto), base=text(String(source.posto || '').split(/\s+-\s+/)[0]).replace(/\b(?:do|dos|da|das|de)\b/g,'').replace(/\s+/g,' ').trim();
    const city=text(source.municipio_posto || source.municipio || source.cidade), uf=text(source.uf_posto || source.uf), cep=digits(source.cep_posto || source.cep), address=text(source.endereco_posto || source.endereco);
    const ranked=list.map(station=>{
      const names=[station.fantasia,station.razao].map(text).filter(Boolean), stationBase=text(station.fantasia || station.razao).replace(/\b(?:do|dos|da|das|de)\b/g,'').replace(/\s+/g,' ').trim();let score=0, evidence=[];
      if(names.includes(wanted)){score+=100;evidence.push('nome');}else if(base && stationBase===base){score+=80;evidence.push('nome');}else if(wanted && names.some(name=>wanted.includes(name) || name.includes(wanted))){score+=45;evidence.push('nome parcial');}
      const stationCity=text(station.municipio), stationUf=text(station.uf), stationCep=digits(station.cep), stationAddress=text(station.endereco);
      if(city){if(stationCity===city){score+=50;evidence.push('município');}else score-=100;}
      else if(stationCity && wanted.includes(stationCity)){score+=40;evidence.push('município');}
      if(uf){if(stationUf===uf){score+=15;evidence.push('UF');}else score-=40;}
      else if(stationUf && new RegExp(`(?:^| )${stationUf}(?:$| )`).test(wanted)){score+=10;evidence.push('UF');}
      if(cep){if(stationCep===cep){score+=60;evidence.push('CEP');}else score-=100;}
      if(address){const tokens=address.split(' ').filter(x=>x.length>2), common=tokens.filter(x=>stationAddress.includes(x)).length;if(tokens.length && common/tokens.length>=.6){score+=60;evidence.push('endereço');}else score-=80;}
      return {station,score,evidence};
    }).filter(x=>x.score>=45).sort((a,b)=>b.score-a.score);
    if(!ranked.length)return {station:null,method:'Nome e endereço',candidates:[],error:'Posto não encontrado'};
    if(ranked[1] && ranked[0].score===ranked[1].score)return {station:null,method:'Nome e endereço',candidates:ranked.filter(x=>x.score===ranked[0].score).map(x=>stationLabel(x.station)),error:'Nome do posto ambíguo; informe CNPJ, ID, município/UF, CEP ou endereço'};
    return {station:ranked[0].station,method:ranked[0].evidence.join(' + '),candidates:[]};
  }
  const usableAgreement = agreement => ['vigente','encerrado','vencido','expirado'].includes(text(agreement.status || 'Vigente'));
  const agreementDateConflict = (agreement, agreements, ignoredId = agreement?.id) => {
    if(text(agreement?.status || 'Vigente')==='cancelado')return null;
    const start=isoDate(agreement?.inicio),end=agreement?.fim?isoDate(agreement.fim):'9999-12-31';
    if(!start || !end)return null;
    return (agreements || []).find(other=>{
      if(String(other?.id || '')===String(ignoredId || '') || text(other?.status || 'Vigente')==='cancelado')return false;
      const otherStart=isoDate(other?.inicio),otherEnd=other?.fim?isoDate(other.fim):'9999-12-31';
      return other?.postoId===agreement?.postoId && other?.produtoId===agreement?.produtoId && !!otherStart && start<=otherEnd && otherStart<=end;
    }) || null;
  };
  const agreementMatches = (agreement, stationId, productId, date) => {
    const start=agreement.inicio?isoDate(agreement.inicio):'',end=agreement.fim?isoDate(agreement.fim):'9999-12-31';
    return agreement.postoId===stationId && (!productId || agreement.produtoId===productId) && usableAgreement(agreement) && !!start && date>=start && date<=end;
  };
  function findAgreement(agreements, stationId, productId, date) {
    return (agreements || []).filter(a=>agreementMatches(a,stationId,productId,date)).sort((a,b)=>isoDate(b.inicio).localeCompare(isoDate(a.inicio)))[0];
  }
  function applyAgreementPrice(quantity, importedPrice, importedTotal, agreement) {
    const price=agreement?Number(agreement.preco || 0):Number(importedPrice || 0);
    return {price,total:Number(quantity || 0)*price,source:agreement?'Acordo válido na data':'Arquivo',originalPrice:importedPrice ?? null,originalTotal:importedTotal ?? null};
  }
  function fuelingCapacityError(quantity, vehicle) {
    const liters=Number(quantity), capacity=Number(vehicle?.capTanque || 0), plate=String(vehicle?.placa || '').trim();
    if(!(capacity>0))return `Capacidade do veículo não cadastrada${plate ? `: ${plate}` : ''}`;
    if(liters>capacity)return `Erro de capacidade: ${liters.toLocaleString('pt-BR',{maximumFractionDigits:2})} L excede a capacidade cadastrada de ${capacity.toLocaleString('pt-BR',{maximumFractionDigits:2})} L${plate ? ` para ${plate}` : ''}`;
    return '';
  }
  function resolveGekonProduct(value, stationId, date, agreements, products) {
    const matches=(agreements || []).filter(a=>agreementMatches(a,stationId,null,date)&&(a.gekonProducts || []).some(v=>text(v)===text(value)));
    if(matches.length!==1)return {error:matches.length?'Produto Gekon com mais de um acordo válido na data':'Produto Gekon sem De/Para em acordo válido na data'};
    const product=(products || []).find(p=>p.id===matches[0].produtoId);
    return product?{product,agreement:matches[0]}:{error:'Produto do acordo não encontrado'};
  }
  window.DirectFuelImportRules={resolveGekonProduct,text,digits,isoDate,todayIso,effectiveAgreementStatus,isAgreementOpen,stationLabel,parseCsv,resolveStation,usableAgreement,agreementDateConflict,agreementMatches,findAgreement,applyAgreementPrice,fuelingCapacityError};
})();
