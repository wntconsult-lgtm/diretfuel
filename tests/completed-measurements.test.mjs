import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../public/directfuel-enterprise.js", import.meta.url), "utf8");

test("completed measurements start with actions and default to not approved", () => {
  assert.match(source, /<th>Ações<\/th><th>Medição<\/th><th>Data de gravação<\/th>/);
  assert.match(source, /value="not-approved" selected>Não aprovadas/);
  assert.match(source, /status==="not-approved"\?isUnapprovedMeasurement\(m\)/);
});

test("completed measurements expose the requested combined filters", () => {
  for (const id of ["completedMeasurementFilter", "completedInvoiceFilter", "completedAgreementFilter", "completedStatusFilter", "completedSavedByFilter", "completedReasonFilter"]) assert.ok(source.includes(id), `missing ${id}`);
  assert.ok(!source.includes("completedSavedDateFilter"), "saved date filter must remain disabled");
  assert.match(source, /measurementInvoiceNumbers/);
  assert.match(source, /<option value="all">Todos<\/option>/);
  assert.match(source, /status==="all"/);
  assert.match(source, /agreement==="all"/);
  assert.match(source, /id="showAllCompleted">Exibir todas/);
  assert.match(source, /id="completedMeasurementRows"/);
  assert.match(source, /tbody\.replaceChildren\(\)/);
  assert.match(source, /filtered\.forEach\(record=>tbody\.append\(measurementRow\(record\)\)\)/);
  assert.match(source, /const renderedCount=filtered\.length\?tbody\.rows\.length:0/);
  assert.doesNotMatch(source, /filtered\.map\(rowHtml\)/);
  assert.match(source, /Todos \(\$\{records\.length\}\)/);
  assert.match(source, /const filterState=\{number:"",station:"",invoice:"",agreement:"all",status:"not-approved"/);
  assert.match(source, /Object\.assign\(filterState,\{number:"",station:"",invoice:"",agreement:"all",status/);
});

test("completed measurements render each filtered record as an independent DOM row", () => {
  assert.match(source, /const measurementRow=.*document\.createElement\("tr"\)/);
  assert.match(source, /row\.className="completed-measurement-row";row\.hidden=false/);
  assert.match(source, /row\.style\.setProperty\("display","table-row","important"\)/);
  assert.match(source, /row\.dataset\.completedId=String\(m\.id\|\|""\)/);
  assert.match(source, /element\.textContent=value/);
  assert.match(source, /button\.onclick=\(\)=>handler\(measurement\)/);
});

test("completed measurement rows cannot inherit a conflicting hidden state", async () => {
  const css = await readFile(new URL("../public/directfuel-styles.css", import.meta.url), "utf8");
  assert.match(source, /tbody\.hidden=false;tbody\.style\.setProperty\("display","table-row-group","important"\)/);
  assert.match(css, /\.completed-measurements-table \.completed-measurement-row\[hidden\]\{display:table-row!important;visibility:visible!important;opacity:1!important\}/);
});

test("legacy measurements recover their saved date without requiring salvoEm", () => {
  assert.match(source, /history\[0\]\|\|med\.confirmadoEm\|\|med\.aprovadoEm\|\|med\.devolvidaEm/);
});

test("large invoice lists stay compact without losing filtering or export data", () => {
  assert.match(source, /part\.length%6===0\?\(part\.match\(\/\\d\{6\}\/g\)\|\|\[\]\)/);
  assert.match(source, /const invoiceCell=document\.createElement\("td"\),preview=nfs\.slice\(0,3\)/);
  assert.match(source, /invoiceCell\.dataset\.exportValue=nfs\.join\(", "\)/);
  assert.match(source, /\+\$\{nfs\.length-preview\.length\} NF\(s\)/);
});

test("approval displays and applies the configured fiscal tolerance", () => {
  assert.match(source, /directFuelMeasurementTolerance/);
  assert.match(source, /Tolerância configurada/);
  assert.match(source, /Math\.abs\(diff\) <= tolerance/);
});

test("RC SAP generation is a top batch action driven by row selectors", () => {
  assert.match(source, /id="showAllCompleted">Exibir todas<\/button>\$\{mayExport\?'<button class="btn secondary" id="generateSelectedRcSap" disabled>Gerar RC SAP \(0\)/);
  assert.match(source, /const selectedRcIds=new Set\(\)/);
  assert.match(source, /selector\.className="rcSapSelection"/);
  assert.match(source, /selector\.disabled=!eligible/);
  assert.match(source, /DirectFuelRcSap\?\.createBatch\(db,measurements,options\)/);
  assert.doesNotMatch(source, /createButton\("Gerar RC SAP","btn small secondary generateRcSap"/);
});
