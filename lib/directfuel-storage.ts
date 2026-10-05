export const STATE_LIMIT_BYTES = 8_000_000;
export function storageUsage(serialized: string) {
  const bytes = new TextEncoder().encode(serialized).byteLength;
  const percent = bytes / STATE_LIMIT_BYTES * 100;
  return {bytes, limitBytes:STATE_LIMIT_BYTES, percent, level:percent >= 90 ? 'critical' : percent >= 70 ? 'warning' : 'normal', scope:'application-state'};
}
export function applyStateDelta(previous: Record<string, unknown>, delta: unknown): Record<string, unknown> {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) throw Error('Alterações inválidas.');
  const next = {...previous};
  for (const [key, raw] of Object.entries(delta)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ['__proto__','constructor','prototype'].includes(key) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Campo de alteração inválido.');
    const change = raw as Record<string, unknown>;
    if (change.drop === true) { delete next[key]; continue; }
    if (Object.hasOwn(change,'replace')) { next[key] = change.replace; continue; }
    if (!Array.isArray(previous[key]) || !Array.isArray(change.upsert) || !Array.isArray(change.remove)) throw Error('Coleção de alteração inválida.');
    const rows = previous[key] as Array<Record<string,unknown>>;
    if (rows.some(row => !row || typeof row.id !== 'string') || new Set(rows.map(row=>row.id)).size !== rows.length) throw Error('Coleção sem identificadores únicos.');
    if (change.remove.some(id=>typeof id !== 'string') || change.upsert.some(row=>!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id)) throw Error('Identificador de alteração inválido.');
    const removed = new Set(change.remove);
    const map = new Map(rows.filter(row=>!removed.has(row.id)).map(row=>[row.id,row]));
    for (const row of change.upsert as Array<Record<string,unknown>>) map.set(row.id,row);
    if (change.order !== undefined) {
      if (!Array.isArray(change.order) || change.order.length !== map.size || new Set(change.order).size !== map.size || change.order.some(id=>!map.has(id))) throw Error('Ordem da coleção inválida.');
      next[key] = change.order.map(id=>map.get(id));
    } else next[key] = [...map.values()];
  }
  return next;
}
