import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeStoredState,encodeStoredState,storedStateBytes,D1_STATE_ROW_LIMIT_BYTES} from '../lib/directfuel-state-codec.ts';

test('state codec keeps small legacy JSON readable',async()=>{
  const state={users:[{id:'U1',nome:'Wagner'}],version:1};
  const serialized=JSON.stringify(state);
  const stored=await encodeStoredState(serialized);
  assert.equal(stored,serialized);
  assert.deepEqual(await decodeStoredState(stored),state);
});

test('state codec compresses a large DirectFuel state below the D1 row limit',async()=>{
  const state={
    abastecimentos:Array.from({length:12000},(_,index)=>({
      id:`AB-${index}`,data:'2026-09-18',placa:`ABC${String(index).padStart(4,'0')}`,
      produto:'Diesel S10',posto:'Posto DirectFuel',qt:300.25,preco:6.19,
      observacao:'Registro operacional preservado com acentuação: medição e contabilização.'
    }))
  };
  const serialized=JSON.stringify(state);
  assert.ok(new TextEncoder().encode(serialized).byteLength>2_000_000);
  const stored=await encodeStoredState(serialized);
  assert.ok(stored.startsWith('directfuel:gzip:v1:'));
  assert.ok(storedStateBytes(stored)<D1_STATE_ROW_LIMIT_BYTES);
  assert.deepEqual(await decodeStoredState(stored),state);
});
