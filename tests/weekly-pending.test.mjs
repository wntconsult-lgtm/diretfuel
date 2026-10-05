import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window={};vm.runInNewContext(fs.readFileSync('public/directfuel-dashboard-financial.js','utf8'),{window,Date});const api=window.DirectFuelWeeklyPending;
const row=(id,data,extra={})=>({id,data,postoId:'P',produtoId:'D',qt:10,total:60,...extra});
const agreement=(extra={})=>({id:'A',postoId:'P',produtoId:'D',inicio:'2025-01-01',measurementWeekClose:3,measurementWeekDelay:1,...extra});
const state={acordos:[agreement()]};
test('Thursday to Wednesday remains open for the whole Wednesday, then due and late',()=>{
 const rows=[row('1','2026-09-17'),row('2','2026-09-21')];
 for(const day of ['2026-09-21','2026-09-22','2026-09-23'])assert.equal(api.summarize(state,rows,day).current.count,2);
 const thursday=api.summarize(state,rows,'2026-09-24');assert.equal(thursday.ready.count,2);assert.equal(thursday.groups[0].start,'2026-09-17');assert.equal(thursday.groups[0].end,'2026-09-23');
 assert.equal(api.summarize(state,rows,'2026-09-25').oldest.days,1);
});
test('closed cycles before deadline share the measure-today group and agreements use independent calendars',()=>{
 const db={acordos:[agreement({measurementWeekDelay:2}),agreement({id:'B',produtoId:'ARLA',measurementWeekClose:2,measurementWeekDelay:2})]};
 const w=api.summarize(db,[row('1','2026-09-21'),row('2','2026-09-21',{produtoId:'ARLA'})],'2026-09-23');assert.equal(w.current.count,1);assert.equal(w.ready.count,1);
});
test('unconfigured and ambiguous agreements never silently inherit global deadlines',()=>{
 for(const db of [{},{acordos:[agreement({measurementWeekClose:null})]},{acordos:[agreement(),agreement({id:'B'})]}])assert.equal(api.summarize(db,[row('1','2026-09-01')],'2026-09-21').unconfigured.count,1);
});
test('agreement is selected by fueling date, including ended agreements, and explicit valid link',()=>{
 const db={acordos:[agreement({fim:'2026-09-20',status:'Encerrado'}),agreement({id:'B',inicio:'2026-09-21',measurementWeekClose:5})]};
 const w=api.summarize(db,[row('1','2026-09-18'),row('2','2026-09-21')],'2026-09-24');assert.equal(w.ready.count,1);assert.equal(w.current.count,1);
});
test('partial measurements, new cycles and exception amounts reconcile',()=>{
 const rows=[row('1','2026-09-10'),row('2','2026-09-17'),row('3','2026-09-24'),row('4','2026-09-18',{medicaoId:'M'}),row('5','bad'),row('6','2026-10-01'),row('7','2026-09-20',{produtoId:'X'})];
 const w=api.summarize(state,rows,'2026-09-24');assert.equal(w.total.count,6);assert.equal(w.total.value,w.critical.value+w.late.value+w.ready.value+w.dueToday.value+w.current.value+w.unconfigured.value+w.other.value);assert.equal(w.critical.count,1);assert.equal(w.current.count,1);
});
test('zero-day deadline preserves full closure across year boundary',()=>{
 const db={acordos:[agreement({measurementWeekDelay:0})]};assert.equal(api.summarize(db,[row('1','2025-12-31')],'2025-12-31').current.count,1);const w=api.summarize(db,[row('1','2025-12-31')],'2026-01-01');assert.equal(w.oldest.days,1);assert.equal(w.oldest.start,'2025-12-25');
});

test('first two overdue civil days are yellow; third day is red',()=>{
 const rows=[row('1','2026-09-17')];
 for(const day of ['2026-09-25','2026-09-26']){const w=api.summarize(state,rows,day);assert.equal(w.late.count,1);assert.equal(w.critical.count,0);}
 const w=api.summarize(state,rows,'2026-09-27');assert.equal(w.late.count,0);assert.equal(w.critical.count,1);assert.equal(w.oldest.days,3);
});
