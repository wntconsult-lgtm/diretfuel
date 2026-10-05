type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === "object" && !Array.isArray(item)) : [];
const ids = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];
const amount = (value: unknown) => Number(value || 0);
const confirmed = (status: unknown) => ["Confirmado", "Aprovada", "Conciliada"].includes(String(status));

function toleranceLimit(state: Row, expected: number) {
  const params = (state.config as { params?: Row } | undefined)?.params || {};
  const fixed = Math.max(0, amount(params.medicaoToleranciaValor));
  const percent = Math.max(0, amount(params.medicaoToleranciaPercentual));
  const percentValue = Math.abs(expected) * percent / 100;
  const mode = String(params.medicaoToleranciaRegra || "maior");
  if (mode === "fixa") return fixed;
  if (mode === "percentual") return percentValue;
  if (mode === "menor") return Math.min(fixed, percentValue);
  return Math.max(fixed, percentValue);
}

function fiscalIdentity(note: Row) {
  const accessKey = String(note.chave || note.chaveNfe || "").replace(/\D/g, "");
  if (accessKey) return `chave:${accessKey}`;
  return ["fallback", String(note.cnpjEmitente || "").replace(/\D/g, ""), String(note.numero || "").trim(), String(note.serie || "").trim(), String(note.emissao || note.dataEmissao || "").slice(0, 10), amount(note.valorTotal ?? note.valor).toFixed(2)].join(":");
}

export function invoiceValidation(state: Row, previousState?: Row) {
  const rawVolume = (state.config as {params?: Row} | undefined)?.params?.medicaoToleranciaVolume;
  if (rawVolume != null && (typeof rawVolume !== "number" || !Number.isFinite(rawVolume) || rawVolume < 0)) return "A tolerância de volume deve ser um número válido, igual ou maior que zero.";
  const volumeLimit = Number(rawVolume ?? .01);
  const fuelings = rows(state.abastecimentos), measurements = rows(state.medicoes), stations = rows(state.postos), agreements = rows(state.acordos);
  const previousMeasurements = new Map(rows(previousState?.medicoes).map((item) => [String(item.id || ""), item]));
  const identities = new Map<string, string>(), fuelingOwners = new Map<string, string>();
  for (const measurement of measurements) {
    const measurementId = String(measurement.id || ""), selectedIds = ids(measurement.itens), selected = new Set(selectedIds), returned = String(measurement.status || "") === "Devolvida para pendentes";
    if ((returned && selected.size) || (!returned && !selected.size) || selected.size !== selectedIds.length) return "Seleção de abastecimentos inválida.";
    if (returned) continue;
    for (const id of selectedIds) {
      const fueling = fuelings.find((item) => String(item.id) === id), previousOwner = fuelingOwners.get(id);
      if (!fueling || fueling.postoId !== measurement.postoId || (fueling.medicaoId && fueling.medicaoId !== measurement.id) || (previousOwner && previousOwner !== measurementId)) return "Abastecimento inválido ou já vinculado a outra medição.";
      fuelingOwners.set(id, measurementId);
    }
    const notes = rows(measurement.notasFiscais);
    for (const note of notes) {
      const identity = fiscalIdentity(note);
      if (identity !== "fallback:::::0.00") {
        const owner = identities.get(identity);
        if (owner && owner !== measurementId) return "NF já cadastrada em outra medição.";
        if (owner === measurementId) return "NF duplicada na medição.";
        identities.set(identity, measurementId);
      }
      const accessKey = String(note.chave || note.chaveNfe || "").replace(/\D/g, "");
      if (accessKey && !/^\d{44}$/.test(accessKey)) return "Chave NF-e inválida.";
      if (amount(note.quantidadeTotal ?? note.qt) < 0 || amount(note.valorTotal ?? note.valor) < 0) return "Dados da NF inválidos.";
      for (const item of rows(note.itensFiscais)) if (amount(item.quantidade) < 0 || amount(item.valorUnitario) < 0 || amount(item.valorTotal) < 0) return "Item fiscal com quantidade ou valor inválido.";
      for (const installment of rows(note.parcelas)) if (amount(installment.valor) < 0) return "Parcela da NF com valor inválido.";
    }
    if (!confirmed(measurement.status)) continue;
    const previousMeasurement = previousMeasurements.get(measurementId);
    // An approved measurement is a historical fiscal record. Editing an agreement
    // must not revalidate an unchanged measurement against today's De/Para dates.
    // Structural invariants and duplicate NFs above remain protected globally.
    if (previousMeasurement && confirmed(previousMeasurement.status) && JSON.stringify(previousMeasurement) === JSON.stringify(measurement)) continue;
    if (!notes.length) return "Adicione ao menos uma NF antes de confirmar a medição.";
    if (notes.some((note) => !/^\d{44}$/.test(String(note.chave || note.chaveNfe || "").replace(/\D/g, "")) || !String(note.numero || "").trim() || !(String(note.vencimento || "").trim() || rows(note.parcelas).some((item) => String(item.vencimento || "").trim())) || amount(note.valorTotal ?? note.valor) <= 0 || (!note.arquivada && !rows(note.itensFiscais).length))) return "Complete os dados das NFs sinalizadas com erro de leitura.";
    if (notes.some((note) => String(note.postoStatus || "") === "POSTO NÃO IDENTIFICADO")) return "Identifique o posto de todas as NFs antes de confirmar.";
    if (notes.some((note) => !note.arquivada && rows(note.itensFiscais).some((item) => !item.produtoDirectFuelId))) return "Identifique todos os produtos fiscais antes de confirmar.";
    const measurementFuelings = fuelings.filter((item) => selected.has(String(item.id)));
    if (measurement.conferenciaNfAtivada) {
      const linkedFuelings = new Set<string>();
      for (const note of notes) {
        if (!note.conferenciaConfirmada) return "Confirme a conferência de todas as NFs antes de concluir a medição.";
        const linkedIds=ids(note.abastecimentoIds);
        if (!linkedIds.length) return "Há NF sem abastecimento DirectFuel vinculado.";
        const linked=linkedIds.map((id) => measurementFuelings.find((item) => String(item.id) === id));
        if (linked.some((item) => !item)) return "A NF possui vínculo com abastecimento fora desta medição.";
        if (linkedIds.some((id) => linkedFuelings.has(id))) return "O mesmo abastecimento está vinculado a mais de uma NF.";
        linkedIds.forEach((id) => linkedFuelings.add(id));
        const validLinked=linked.filter((item): item is Row => !!item),invoiceDate=String(note.emissao || note.dataEmissao || "").slice(0,10),products=new Set(rows(note.itensFiscais).map((item) => String(item.produtoDirectFuelId || "")).filter(Boolean));
        if (validLinked.some((item) => invoiceDate && String(item.data || "").slice(0,10) > invoiceDate)) return "Há abastecimento posterior à emissão da NF.";
        const linkedQuantity=validLinked.reduce((sum,item)=>sum+amount(item.qt),0),linkedValue=validLinked.reduce((sum,item)=>sum+amount(item.total),0);
        if (Math.abs(amount(note.quantidadeTotal ?? note.qt)-linkedQuantity)>volumeLimit+0.000001) return `A quantidade da NF diverge dos abastecimentos vinculados. Tolerância de volume: ±${volumeLimit} L.`;
        const noteJustified=measurement.divergenciaAceita && String(measurement.divergenciaJustificativa || "").trim().length >= 5;
        if (Math.abs(amount(note.valorTotal ?? note.valor)-linkedValue)>toleranceLimit(state,linkedValue) && !noteJustified) return "O valor da NF excede a tolerância dos abastecimentos vinculados.";
        if (!note.arquivada && validLinked.some((item) => !products.has(String(item.produtoId || "")))) return "O produto do abastecimento não corresponde ao produto da NF.";
      }
      if (linkedFuelings.size !== selected.size) return "Todos os abastecimentos da medição devem estar vinculados a uma NF.";
    }
    const expectedQuantity = measurementFuelings.reduce((sum, item) => sum + amount(item.qt), 0), expectedValue = measurementFuelings.reduce((sum, item) => sum + amount(item.total), 0);
    const invoiceQuantity = notes.reduce((sum, note) => sum + amount(note.quantidadeTotal ?? note.qt), 0), invoiceValue = notes.reduce((sum, note) => sum + amount(note.valorTotal ?? note.valor), 0);
    const justified = measurement.divergenciaAceita && String(measurement.divergenciaJustificativa || "").trim().length >= 5;
    if (Math.abs(invoiceQuantity - expectedQuantity) > volumeLimit+0.000001 && !justified) return `A quantidade das NFs diverge da medição. Tolerância de volume: ±${volumeLimit} L. Trate a divergência antes de confirmar.`;
    if (Math.abs(invoiceValue - expectedValue) > toleranceLimit(state, expectedValue) && !justified) return "O valor total das NFs excede a tolerância da medição.";
    const station = stations.find((item) => item.id === measurement.postoId), stationTaxId = String(station?.cnpj || "").replace(/\D/g, "");
    if (stationTaxId && notes.some((note) => { const taxId = String(note.cnpjEmitente || "").replace(/\D/g, ""); return taxId && taxId !== stationTaxId; })) return "O emitente da NF não corresponde ao posto da medição.";
    for (const note of notes) for (const item of rows(note.itensFiscais)) {
      const productId = String(item.produtoDirectFuelId || "");
      if (!productId) continue;
      const invoiceDate=String(note.emissao || note.dataEmissao || "").slice(0,10);
      const agreement = agreements.find((entry) => {
        const start=String(entry.inicio || ""),end=String(entry.fim || "9999-12-31"),status=String(entry.status || "Vigente").toLocaleLowerCase("pt-BR");
        return entry.postoId === measurement.postoId && entry.produtoId === productId && status !== "cancelado" && status !== "em aprovação" && !!start && !!invoiceDate && invoiceDate >= start && invoiceDate <= end && rows(entry.fiscalProductMappings).some((mapping) => mapping.ativo !== false && String(mapping.codigoProdutoFiscal || "").trim().toUpperCase() === String(item.codigoProdutoFiscal || "").trim().toUpperCase());
      });
      if (!agreement && !item.associacaoSomenteMedicao) return "Há produto fiscal sem De/Para válido para o posto e acordo.";
    }
  }
  return null;
}
