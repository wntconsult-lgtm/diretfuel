(() => {
  const digits=value=>String(value||'').replace(/\D/g,'');
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
  function fingerprint(group) {
    const text=normalize(group.pages[0]?.text),section=text.split(/DADOS DO[S]? PRODUTOS? \/ SERVICOS/)[1]||'';
    const header=section.split(/\b[A-Z0-9._/-]{3,30}\s+(?:[A-Z -]+\s+)?\d{8}\s+\d{2,4}\s+\d{4}\s+[A-Z]{1,4}\s+[\d.,]+/)[0].slice(0,650);
    const words=(header.match(/\b(?:CODIGO|DESCRICAO|NCM|CSOSN|CST|CFOP|UNID|UN|QUANT|QUANTIDADE|VALOR|UNITARIO|TOTAL|DESCONTO|BASE|ICMS|IPI|ALIQUOTAS)\b/g)||[]).join('|');
    const billing=/FATURA\s*\/?\s*DUPLICATA/.test(text)?'fatura-duplicata':/DUPLICATAS/.test(text)?'duplicatas':'outro';
    const source=`1|${billing}|${/PROJETO ACBR/.test(text)?'acbr':'geral'}|${words}`;
    let hash=2166136261;for(const char of source)hash=Math.imul(hash^char.charCodeAt(0),16777619);
    return `L1-${(hash>>>0).toString(16)}`;
  }
  function select(layouts, cnpj, signature) {
    return (layouts||[]).filter(item=>item.active&&item.status==='validated'&&digits(item.cnpj)===digits(cnpj)&&item.fingerprint===signature).sort((a,b)=>b.version-a.version)[0]||null;
  }
  function read(pages, layouts=[]) {
    const parser=window.DirectFuelDanfeParser;
    return parser.groupPages(pages).map(group=>{
      const base=parser.parseGroup(group),signature=fingerprint(group),profile=select(layouts,base.cnpjEmitente,signature);
      const result=profile?parser.parseGroup(group,profile.rules):base;
      return {...result,layoutFingerprint:signature,layoutId:profile?.id||'',layoutVersion:profile?.version||null,layoutName:profile?.name||'',layoutStatus:profile?'recognized':'review',layoutParserVersion:1};
    });
  }
  function summary(note){return {numero:String(note.numero||''),cnpj:digits(note.cnpjEmitente),vencimento:note.vencimento||'',valor:Number(note.valorTotal||0),quantidade:(note.itensFiscais||[]).reduce((sum,item)=>sum+Number(item.quantidade||0),0),itens:(note.itensFiscais||[]).map(item=>({codigo:item.codigoProdutoFiscal,quantidade:item.quantidade,preco:item.valorUnitario,total:item.valorTotal}))};}
  function validate(note, expected){const actual=summary(note),errors=[...(note.errosLeitura||[])];for(const key of ['numero','cnpj','vencimento'])if(!(key==='vencimento'&&note.vencimentoAusentePermitido&&!expected[key]&&!actual[key])&&(!expected[key]||String(actual[key])!==String(expected[key])))errors.push(`${{numero:'Número da NF',cnpj:'CNPJ',vencimento:'Vencimento'}[key]} diferente do valor conferido.`);for(const key of ['valor','quantidade'])if(!(Number(expected[key])>0)||Math.abs(actual[key]-Number(expected[key]))>0.005)errors.push(`${key==='valor'?'Valor total':'Quantidade'} diferente do valor conferido.`);if(!actual.itens.length||actual.itens.some(item=>!(item.quantidade>0)||!(item.preco>0)||!(item.total>0)))errors.push('Confira quantidade, preço e total de todos os itens.');if(expected.itens&&JSON.stringify(actual.itens)!==JSON.stringify(expected.itens))errors.push('Os itens diferem da referência anteriormente conferida.');return [...new Set(errors)];}
  window.DirectFuelLayouts={fingerprint,select,read,summary,validate};
})();
