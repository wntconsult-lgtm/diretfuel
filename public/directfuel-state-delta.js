(() => {
  const validKey = key => /^[A-Za-z][A-Za-z0-9_]*$/.test(key) && !['__proto__','prototype','constructor'].includes(key);
  const indexed = value => Array.isArray(value) && value.every(row => row && typeof row === 'object' && typeof row.id === 'string' && row.id) && new Set(value.map(row => row.id)).size === value.length;
  function create(before, after) {
    const delta = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!validKey(key)) throw Error('Campo de dados inválido.');
      // Auditoria é mantida exclusivamente pelo servidor. A versão exibida na
      // leitura pode diferir da cópia interna do estado e nunca deve gerar delta.
      if (key === 'audit') continue;
      const old = before[key], next = after[key];
      if (JSON.stringify(old) === JSON.stringify(next)) continue;
      if (!(key in after)) { delta[key] = {drop:true}; continue; }
      if (!indexed(old) || !indexed(next)) { delta[key] = {replace:next}; continue; }
      const oldMap = new Map(old.map(row => [row.id, JSON.stringify(row)])), ids = new Set(next.map(row => row.id));
      const change = {upsert:next.filter(row => oldMap.get(row.id) !== JSON.stringify(row)), remove:old.filter(row => !ids.has(row.id)).map(row => row.id)};
      const natural = [...old.filter(row => ids.has(row.id)), ...next.filter(row => !oldMap.has(row.id))].map(row => row.id);
      if (JSON.stringify(natural) !== JSON.stringify(next.map(row => row.id))) change.order = next.map(row => row.id);
      delta[key] = change;
    }
    return delta;
  }
  window.DirectFuelStateDelta = {create};
})();
