import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const window={};
vm.runInNewContext(readFileSync(new URL("../public/directfuel-danfe-parser.js",import.meta.url),"utf8"),{window});
const parser=window.DirectFuelDanfeParser;
const key1="33260818070608000158550020006397041427036310";
const key2="33260918070608000158550020006417001273025626";
const page=(key,number=639704)=>`
RECEBEMOS DE AUTO POSTO JR TANGUA LTDA. VALOR TOTAL: 1859.34
DANFE CHAVE DE ACESSO ${key}
Nº ${number}
SÉRIE: 2
DATA EMISSÃO 31/08/2026
FATURA / DUPLICATA
Vencimento: 21/09/2026;
Valor: R$ 1.859,34;
CALCULO DO IMPOSTO
DADOS DO PRODUTOS / SERVIÇOS
ORIGINAL DIESEL S-10 ADITIVADO Tributos
001843 820101033 27101921 061 5656 L 266.0000 6,99 0,00 0,00 1.859,34 0 0 0 0 0
DADOS ADICIONAIS`;

test("extracts the requested fields from a DANFE page",()=>{
  const [note]=parser.parsePages([{pageNumber:1,text:page(key1)}]);
  assert.equal(note.chave,key1);
  assert.equal(note.numero,"639704");
  assert.equal(note.serie,"2");
  assert.equal(note.cnpjEmitente,"18070608000158");
  assert.equal(note.emissao,"2026-08-31");
  assert.equal(note.vencimento,"2026-09-21");
  assert.equal(note.valorTotal,1859.34);
  assert.deepEqual({...note.itensFiscais[0]},{codigoProdutoFiscal:"001843",codigoAnp:"820101033",descricao:"ORIGINAL DIESEL S-10 ADITIVADO",ncm:"27101921",unidade:"L",quantidade:266,valorUnitario:6.99,valorTotal:1859.34});
  assert.deepEqual([...note.errosLeitura],[]);
});

test("groups consecutive pages by access key and separates another invoice",()=>{
  const notes=parser.parsePages([
    {pageNumber:1,text:page(key1)},
    {pageNumber:2,text:`CONTINUAÇÃO DA DANFE CHAVE DE ACESSO ${key1}`},
    {pageNumber:3,text:page(key2,641700)}
  ]);
  assert.equal(notes.length,2);
  assert.deepEqual([...notes[0].paginas],[1,2]);
  assert.deepEqual([...notes[1].paginas],[3]);
});

test("keeps repeated one-page DANFEs as duplicates instead of merging them",()=>{
  const text=page(key1)+"\nFOLHA 1 / 1";
  const notes=parser.parsePages([{pageNumber:1,text},{pageNumber:2,text}]);
  assert.equal(notes.length,2);
  assert.equal(notes[0].chave,notes[1].chave);
});

test("keeps an unreadable DANFE page as an individual error",()=>{
  const notes=parser.parsePages([{pageNumber:7,text:"DANFE sem chave ou dados fiscais legíveis"}]);
  assert.equal(notes.length,1);
  assert.deepEqual([...notes[0].paginas],[7]);
  assert.ok(notes[0].errosLeitura.length>=5);
});

test("rebuilds visual lines from PDF text items instead of their internal order",()=>{
  const item=(str,x,y)=>({str,transform:[1,0,0,1,x,y]});
  const text=parser.textFromItems([
    item("21/09/2026;",160,700),item("Vencimento:",20,700),item("FATURA / DUPLICATA",20,720),
    item("1.859,34",430,300),item("0,00",350,300),item("6,99",300,300),item("266.0000",240,300),
    item("L",220,300),item("5656",180,300),item("061",150,300),item("27101921",95,300),item("820101033",55,300),item("001843",10,300)
  ]);
  assert.match(text,/FATURA \/ DUPLICATA\nVencimento: 21\/09\/2026;/);
  assert.match(text,/001843 820101033 27101921 061 5656 L 266\.0000 6,99 0,00 1\.859,34/);
});

test("repairs PDFCreator Identity-H text and extracts NF 640590",()=>{
  const encode=value=>[...value].map(character=>{
    const code=character.charCodeAt(0);
    if (code>=32 && code<=126) return String.fromCharCode(code-29);
    if (code>=160 && code<=255) return String.fromCharCode(code-62);
    return character;
  }).join("");
  const lines=[
    `DANFE CHAVE DE ACESSO 3326 0918 0706 0800 0158 5500 2000 6405 9014 5830 3438`,
    "Nº 640590 SÉRIE: 2",
    "DATA EMISSÃO 02/09/2026",
    "FATURA / DUPLICATA",
    "Vencimento: 21/09/2026;",
    "Valor: R$ 174,20;",
    "CALCULO DO IMPOSTO",
    "VALOR TOTAL DA NOTA",
    "174,20",
    "CALCULO DO ISSQN",
    "DADOS DO PRODUTOS / SERVIÇOS",
    "IPI ARLA GRVD Tributos Incidentes 35.45 % = 61.75 Fonte: IBPT -",
    "000583 31021010 00 5102 L 43.6600 3,99 0,00 0,00 174,20 174.20 34.84 0 20.00 0",
    "DADOS ADICIONAIS"
  ];
  const items=lines.map((line,index)=>({str:encode(line),transform:[1,0,0,1,10,800-index*20]}));
  const text=parser.textFromItems(items);
  assert.match(text,/AUTO|DANFE/);
  const [note]=parser.parsePages([{pageNumber:1,text}]);
  assert.equal(note.chave,"33260918070608000158550020006405901458303438");
  assert.equal(note.numero,"640590");
  assert.equal(note.serie,"2");
  assert.equal(note.cnpjEmitente,"18070608000158");
  assert.equal(note.emissao,"2026-09-02");
  assert.equal(note.vencimento,"2026-09-21");
  assert.equal(note.valorTotal,174.2);
  assert.deepEqual({...note.itensFiscais[0]}, {
    codigoProdutoFiscal:"000583",codigoAnp:"",descricao:"IPI ARLA GRVD",ncm:"31021010",
    unidade:"L",quantidade:43.66,valorUnitario:3.99,valorTotal:174.2
  });
  assert.deepEqual([...note.errosLeitura],[]);
});

// Regression: ACBr/Cinadis, dotted NF number, DUPLICATAS with VENC.,
// repeated material at different prices and total before discount/taxes.
test("ACBr layout preserves separate prices and reads duplicate due date and item totals",()=>{
 const text=`DANFE CHAVE DE ACESSO 35260959149997000199550010001827151001015719
 Nº 000.182.715 SÉRIE 001 EMISSÃO 15/09/2026
 DUPLICATAS
 Nº DUPLICATA VENC. VALOR Nº DUPLICATA VENC. VALOR
 001 30/09/2026 16.731,24
 CÁLCULO DO IMPOSTO
 VALOR TOTAL DA NOTA 16.731,24 TRANSPORTADOR
 DADOS DO PRODUTO / SERVIÇOS
 VALOR VALOR DESCONTO BASE VALOR VALOR ALÍQUOTAS
 UNITÁRIO TOTAL CÁLC. ICMS
 820101034 DIESEL S-10 COMUM 27101921 061 6929 L 1.322,03 6,4900 8.579,97 0,00 0,00 0,00
 820101034 DIESEL S-10 COMUM 27101921 061 6929 L 1.180,00 6,5900 7.776,20 0,00 0,00 0,00
 740101005 ARLA32 A GRANEL 31021010 060 6929 L 117,58 3,1900 375,07 0,00 0,00 0,00
 DADOS ADICIONAIS`;
 const [note]=parser.parsePages([{pageNumber:1,text},{pageNumber:2,text:'DANFE CHAVE DE ACESSO 35260959149997000199550010001827151001015719 CONTINUAÇÃO DAS INFORMAÇÕES COMPLEMENTARES'}]);
 assert.equal(note.numero,'182715');assert.equal(note.vencimento,'2026-09-30');
 assert.equal(note.itensFiscais.length,3);assert.deepEqual(Array.from(note.itensFiscais,item=>item.valorTotal),[8579.97,7776.2,375.07]);
 assert.deepEqual(Array.from(note.itensFiscais,item=>item.valorUnitario),[6.49,6.59,3.19]);
 assert.equal(note.valorTotal,16731.24);assert.equal(note.errosLeitura.length,0);
});
test('output indicator before a spaced key cannot shift the invoice or issuer',()=>{
 const key='35260959149997000199550010001827151001015719';
 const positioned=parser.textFromItems([{str:'1 - SAÍDA 1',transform:[1,0,0,1,10,100]},{str:key.match(/.{4}/g).join(' '),transform:[1,0,0,1,100,100]}]);
 assert.equal(parser.accessKey(positioned),key);
 assert.equal(parser.accessKey('13526095914999700019955001000182715100101571'),'');
 const [note]=parser.parsePages([{pageNumber:1,text:`RECEBEMOS DE CINADIS REVENDEDORA DE COMBUSTÍVEL LTDA OS PRODUTOS\n${positioned}\nNº 000.182.715`}]);
 assert.equal(note.numero,'182715');assert.equal(note.cnpjEmitente,'59149997000199');
 assert.equal(note.razaoSocial,'CINADIS REVENDEDORA DE COMBUSTÍVEL LTDA');
});
