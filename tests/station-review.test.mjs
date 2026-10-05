import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const raw = readFileSync(new URL('../app/api/geo-analysis/route.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const analyze = vm.runInNewContext(stripTypeScriptTypes(raw) + '\nanalyzeRows;', { URL, setTimeout });
const state = { frota: [{id:'V',placa:'ABC1234'}], produtos:[{id:'P',curta:'Diesel S10'}], postos:['A','B'].map(id=>({id,fantasia:'POSTO RETIRO',municipio:'TANGUA',uf:'RJ',latitude:-22.7,longitude:-42.7})), acordos:['A','B'].map(postoId=>({id:postoId,postoId,produtoId:'P',preco:5,status:'Vigente'})) };
const row = {station_code:'4205111',station_name:'POSTO RETIRO',city:'TANGUA',uf:'RJ',latitude:-22.7,longitude:-42.7,plate:'ABC1234',vehicle_link_status:'Vinculado',product:'Diesel S10',occurred_on:'2026-09-10',final_price:6,liters:100};
test('manual decision resolves ambiguous identity and can return to automatic',()=>{
 assert.equal(analyze([row],state,[])[0].analysis_status,'station_match_review');
 const confirmed=analyze([row],{...state,stationReviews:[{stationCode:'4205111',mode:'same',targetId:'B'}]},[])[0];
 assert.equal(confirmed.station_match_type,'manual');
 assert.equal(confirmed.analysis_status,'ready');
 const different=analyze([row],{...state,stationReviews:[{stationCode:'4205111',mode:'different'}]},[])[0];
 assert.notEqual(different.analysis_status,'station_match_review');
 assert.notEqual(different.station_match_type,'manual');
 assert.equal(analyze([row],{...state,stationReviews:[]},[])[0].analysis_status,'station_match_review');
 const missing=analyze([row],{...state,stationReviews:[{stationCode:'4205111',mode:'same',targetId:'deleted'}]},[])[0];
 assert.equal(missing.analysis_status,'station_match_review');
});
test('distant uncomputed alternatives do not create permanent pending routes',()=>{
 const distant={...state,postos:state.postos.map(p=>({...p,latitude:-20,longitude:-40})),geoParams:{maxRoadDistanceKm:30}};
 assert.equal(analyze([row],distant,[])[0].analysis_status,'no_nearby_station');
 const near={...state,postos:[{...state.postos[0],fantasia:'OUTRO',latitude:-22.71}],stationReviews:[{stationCode:'4205111',mode:'different'}]};
 assert.equal(analyze([row],near,[])[0].analysis_status,'route_pending');
});
