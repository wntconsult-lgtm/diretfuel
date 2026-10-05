type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];

// Omitted fields from older clients must never erase persisted fiscal links.
export function protectFiscalMappings(previous: Row, next: Row): string | null {
  const oldAgreements = new Map(rows(previous.acordos).map(a => [String(a.id), a]));
  for (const agreement of rows(next.acordos)) {
    const old = oldAgreements.get(String(agreement.id));
    const saved = rows(old?.fiscalProductMappings);
    if (!saved.length) continue;
    if (agreement.fiscalProductMappings === undefined) {
      agreement.fiscalProductMappings = structuredClone(saved);
      continue;
    }
    const proposed = rows(agreement.fiscalProductMappings);
    const removed = saved.filter(mapping => !proposed.some(item => mapping.id
      ? item.id === mapping.id
      : String(item.codigoProdutoFiscal) === String(mapping.codigoProdutoFiscal)));
    if (removed.length) return `Gravação bloqueada para proteger o De/Para fiscal do acordo ${old?.numero || agreement.id}: ${removed.map(item => String(item.codigoProdutoFiscal)).join(", ")}. Reabra o acordo com os dados atuais. Para deixar de usar um vínculo, desative-o no De/Para fiscal.`;
  }
  return null;
}
