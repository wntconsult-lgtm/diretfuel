(() => {
  const digits = value => String(value || "").replace(/\D/g, "");
  const compact = value => String(value || "").replace(/\s+/g, " ").trim();
  const isoDate = value => {
    const match=String(value || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
  };
  const number = value => {
    const raw=String(value || "").replace(/[^\d,.-]/g, "");
    if (!raw) return 0;
    if (raw.includes(",") && raw.includes(".")) return Number(raw.replace(/\./g, "").replace(",", ".")) || 0;
    if (raw.includes(",")) return Number(raw.replace(",", ".")) || 0;
    return Number(raw) || 0;
  };
  // Some DANFEs produced by PDFCreator/Ghostscript embed an Identity-H font
  // without a ToUnicode map. PDF.js then exposes the font's internal character
  // codes (for example, "AUTO" becomes "$872" and spaces become U+0003).
  // Detect that signature before decoding so regular PDFs remain untouched.
  const hasLegacyIdentityEncoding = items => {
    const raw=(items || []).map(item=>String(item?.str || "")).join("");
    return [...raw].filter(character=>character.charCodeAt(0)===3).length>=3;
  };
  const decodeLegacyIdentityText = value => [...String(value || "")].map(character=>{
    const code=character.charCodeAt(0);
    if (character===" " || character==="\t" || character==="\n" || character==="\r") return character;
    if (code>=3 && code<=97) return String.fromCharCode(code+29);
    if (code>=98 && code<=193) return String.fromCharCode(code+62);
    return character;
  }).join("");
  function textFromItems(items) {
    const decode=hasLegacyIdentityEncoding(items);
    const positioned=(items || []).map((item,index)=>({
      text:compact(decode ? decodeLegacyIdentityText(item?.str) : item?.str),
      x:Number(item?.transform?.[4] || 0),
      y:Number(item?.transform?.[5] || 0),
      index
    })).filter(item=>item.text);
    const lines=[];
    for (const item of positioned.sort((a,b)=>b.y-a.y || a.x-b.x || a.index-b.index)) {
      let line=lines.at(-1);
      if (line && Math.abs(line.y-item.y)>2) line=null;
      if (!line) { line={y:item.y,items:[]};lines.push(line); }
      line.items.push(item);
    }
    return lines.sort((a,b)=>b.y-a.y).map(line=>line.items.sort((a,b)=>a.x-b.x || a.index-b.index).map(item=>item.text).join(" ")).join("\n");
  }
  function validAccessKey(key) {
    if (!/^\d{44}$/.test(key) || key.slice(20,22) !== "55" || Number(key.slice(4,6)) < 1 || Number(key.slice(4,6)) > 12) return false;
    let sum=0,weight=2;
    for(let i=42;i>=0;i--){sum+=Number(key[i])*weight;weight=weight===9?2:weight+1;}
    const remainder=11-(sum%11),check=remainder>=10?0:remainder;
    return check===Number(key[43]);
  }
  function accessKey(text) {
    for (const run of String(text || "").matchAll(/\d[\d .-]{42,}/g)) {
      const value=digits(run[0]);
      for(let i=0;i<=value.length-44;i++) {const key=value.slice(i,i+44);if(validAccessKey(key))return key;}
    }
    return "";
  }
  function groupPages(pages) {
    const groups=[], activeByKey=new Map();
    let current=null;
    for (const page of pages || []) {
      const key=accessKey(page.text),sheet=compact(page.text).match(/FOLHA\s*(\d+)\s*\/\s*(\d+)/i);
      if (key) {
        current=activeByKey.get(key);
        if (!current || (sheet && Number(sheet[1])===1 && current.pages.length)) { current={key,pages:[]};groups.push(current); }
        current.pages.push(page);
        if (sheet && Number(sheet[1])>=Number(sheet[2])) { activeByKey.delete(key);current=null; }
        else activeByKey.set(key,current);
      } else if (current) {
        current.pages.push(page);
      } else {
        current={key:"",pages:[page]};
        groups.push(current);
      }
    }
    return groups;
  }
  function datesIn(text) {
    return [...String(text || "").matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map(match=>({raw:match[0],iso:`${match[3]}-${match[2]}-${match[1]}`}));
  }
  function emissionDate(text,key) {
    const dates=datesIn(text);
    if (key) {
      const year=`20${key.slice(2,4)}`,month=key.slice(4,6);
      const matching=dates.find(item=>item.iso.startsWith(`${year}-${month}-`));
      if (matching) return matching.iso;
    }
    const labeled=compact(text).match(/DATA\s+EMISS[AÃ]O[^0-9]{0,80}(\d{2}\/\d{2}\/\d{4})/i);
    return isoDate(labeled?.[1] || dates[0]?.raw);
  }
  function dueDate(text, rules = {}) {
    if (rules.dueAnchor) {
      const flat=compact(text), start=flat.toLocaleUpperCase("pt-BR").indexOf(String(rules.dueAnchor).toLocaleUpperCase("pt-BR"));
      if(start>=0){const section=flat.slice(start+rules.dueAnchor.length).split(/C[AÁ]LCULO\s+DO\s+IMPOSTO|TRANSPORTADOR/i)[0].slice(0,700);return datesIn(section)[0]?.iso || "";}
      return "";
    }
    const billing=compact(text).match(/(?:FATURA\s*\/?\s*DUPLICATAS?|DUPLICATAS?)([\s\S]*?)(?:C[AÁ]LCULO\s+DO\s+IMPOSTO|TRANSPORTADOR)/i)?.[1] || "";
    const match=billing.match(/VENCIMENTO\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i);
    return isoDate(match?.[1] || (/\bVENC\./i.test(billing) ? datesIn(billing)[0]?.raw : ""));
  }
  function invoiceTotal(text) {
    const flat=compact(text);
    const section=flat.match(/VALOR\s+TOTAL\s+DA\s+NOTA([\s\S]{0,350}?)(?:C[AÁ]LCULO\s+DO\s+ISSQN|TRANSPORTADOR)/i);
    const values=section ? [...section[1].matchAll(/(?:R\$\s*)?([\d.]+,\d{2})/g)].map(match=>number(match[1])) : [];
    if (values.length) return values.at(-1) || 0;
    const billing=flat.match(/FATURA\s*\/?\s*DUPLICATA[\s\S]{0,500}?VALOR\s*:\s*(?:R\$\s*)?([\d.,]+)/i);
    if (billing) return number(billing[1]);
    const receipt=flat.match(/VALOR\s+TOTAL\s*:\s*(?:R\$\s*)?([\d.,]+)/i);
    return receipt ? number(receipt[1]) : 0;
  }
  function productDescription(lines,index,inline) {
    const cleaned=compact(inline).replace(/\bTributos\b.*$/i, "").trim();
    if (/[A-Za-zÀ-ÿ]/.test(cleaned)) return cleaned;
    for (let offset=1;offset<=3;offset++) {
      const candidate=compact(lines[index-offset]).replace(/\bTributos\b.*$/i, "").trim();
      if (/[A-Za-zÀ-ÿ]/.test(candidate) && !/(C[ÓO]DIGO|DESCRI[CÇ][AÃ]O|NCM|CSOSN|DADOS DO|VALOR|ALIQUOTA)/i.test(candidate)) return candidate;
    }
    return "";
  }
  function itemsFrom(text, rules = {}) {
    const section=String(text || "").match(/DADOS\s+DO[S]?\s+PRODUTOS?\s*\/\s*SERVI[CÇ]OS?([\s\S]*?)(?:DADOS\s+ADICIONAIS|INFORMA[CÇ][OÕ]ES\s+COMPLEMENTSS|$)/i)?.[1] || "";
    const lines=section.split(/\r?\n/),items=[];
    const totalBeforeDiscount=/V\.\s*UNIT[AÁ]RIO\s+V\.\s*TOTAL/i.test(section) || /VALOR\s+VALOR\s+DESCONTO[\s\S]{0,600}?UNIT[AÁ]RIO\s+TOTAL/i.test(section) || /UNIT[AÁ]RIO\s+(?:VALOR\s+)?TOTAL\s+DESCONTO/i.test(section);
    lines.forEach((line,index) => {
      const value=line.trim().replace(/\s+/g, " ");
      const match=value.match(/^([A-Z0-9._\/-]{3,30})\s+(?:(\d{8,10})\s+)?(.*?)\s*(\d{8})\s+\d{2,4}\s+\d{4}\s+([A-Z0-9]{1,4})\s+([\d.,]+)\s+(.+)$/i);
      if (!match || (/^\d+$/.test(match[5]) && !rules.numericUnit)) return;
      const trailing=[...match[7].matchAll(/[\d.,]+/g)].map(found=>number(found[0]));
      if (!trailing.length) return;
      items.push({
        codigoProdutoFiscal:match[1],
        codigoAnp:match[2] || "",
        descricao:productDescription(lines,index,match[3]),
        ncm:match[4],
        unidade:match[5],
        quantidade:number(match[6]),
        valorUnitario:trailing[0] || 0,
        valorTotal:trailing[rules.totalColumn === "second" ? 1 : rules.totalColumn === "fourth" ? 3 : totalBeforeDiscount ? 1 : 3] || 0
      });
    });
    return items;
  }
  function parseGroup(group, rules = {}) {
    const text=group.pages.map(page=>page.text || "").join("\n"),flat=compact(text),key=group.key || accessKey(text);
    const fromKeyNumber=key ? String(Number(key.slice(25,34))) : "";
    const fromKeySeries=key ? String(Number(key.slice(22,25))) : "";
    const numero=fromKeyNumber || String(Number(flat.match(/N[º°O.]?\s*([0-9][0-9.]{0,14})/i)?.[1]?.replace(/\./g, "") || 0) || "");
    const serie=flat.match(/S[ÉE]RIE\s*:?\s*(\d{1,5})/i)?.[1] || fromKeySeries;
    const itens=itemsFrom(text,rules),valorTotal=invoiceTotal(text),emissao=emissionDate(text,key),vencimento=dueDate(text,rules);
    let issuer=compact(text.match(/RECEBEMOS DE\s+([\s\S]*?)\s+OS PRODUTOS/i)?.[1] || "");
    if(rules.issuerStart && rules.issuerEnd){const source=compact(text),upper=source.toLocaleUpperCase("pt-BR"),start=upper.indexOf(String(rules.issuerStart).toLocaleUpperCase("pt-BR"));if(start>=0){const offset=start+rules.issuerStart.length,end=upper.indexOf(String(rules.issuerEnd).toLocaleUpperCase("pt-BR"),offset);issuer=end>offset?source.slice(offset,end).trim():"";}else issuer="";}
    const errors=[];
    if (!key) errors.push("Chave de acesso não identificada");
    if (!numero) errors.push("Número da NF não identificado");
    if (!emissao) errors.push("Data de emissão não identificada");
    if (!vencimento && !rules.allowMissingDue) errors.push("Vencimento não identificado no quadro Fatura/Duplicata");
    if (!(valorTotal > 0)) errors.push("Valor total da NF não identificado");
    if (!itens.length) errors.push("Itens da NF não identificados");
    return {
      vencimentoAusentePermitido:rules.allowMissingDue===true,chave:key,numero,serie,cnpjEmitente:key ? key.slice(6,20) : "",razaoSocial:issuer,emissao,vencimento,valorTotal,
      itensFiscais:itens,paginas:group.pages.map(page=>page.pageNumber),errosLeitura:errors
    };
  }
  function parsePages(pages) { return groupPages(pages).map(group=>parseGroup(group)); }
  window.DirectFuelDanfeParser={accessKey,groupPages,parseGroup,parsePages,number,textFromItems};
})();
