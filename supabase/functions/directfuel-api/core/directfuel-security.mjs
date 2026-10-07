// Generated from lib/directfuel-security.ts. Run node scripts/build-supabase-core.mjs.
import { invoiceValidation } from "./directfuel-invoices.mjs";
                                
                                                
                                          
                   
  

const COLLECTION_PERMISSION                         = {
  distribuidores: "distribuidoras", bases: "bases", produtos: "produtos", unidades: "unidades",
  postos: "postos", frota: "frota", rede: "rede", acordos: "acordos",
  abastecimentos: "abastecimentos", medicoes: "medicoes", nfPendencias: "medicoes", docs: "documentos",
  accountingAdjustments: "medicoes", sapReturns: "medicoes", alertReviews: "audit", fiscalLayouts: "postos",
};

export const BUSINESS_COLLECTIONS = Object.keys(COLLECTION_PERMISSION);
export const isAdmin = (access                  ) => access.isOwner || ["Master", "Administrador"].includes(String(access.directFuelUser.perfil || ""));
export const isMaster = (access                  ) => access.isOwner;
export function hasPermission(access                  , permission        ) {
  if (access.isOwner) return true;
  const permissions = Array.isArray(access.directFuelUser.permissoes) ? access.directFuelUser.permissoes.map(String) : [];
  const actions = Array.isArray(access.directFuelUser.acoes) ? access.directFuelUser.acoes.map(String) : [];
  return permissions.includes("*") || permissions.includes(permission) || actions.includes("*") || actions.includes(`${permission}:visualizar`);
}
export function hasAction(access                  , permission        , action                                                           ) {
  if (access.isOwner) return true;
  const actions = Array.isArray(access.directFuelUser.acoes) ? access.directFuelUser.acoes.map(String) : [];
  return actions.includes("*") || actions.includes(`${permission}:${action}`);
}

const stable = (value         ) => JSON.stringify(value ?? null);
const records = (state                         , key        ) => Array.isArray(state[key]) ? state[key]                                   : [];
const mapById = (items                                ) => new Map(items.map((item) => [String(item.id || ""), item]));
const normalizedPlate = (value         ) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const fuelingFingerprint = (record                         ) => [record.data, record.hora, record.postoId, record.placa, record.produtoId, Number(record.qt || 0).toFixed(3), Number(record.preco || 0).toFixed(4), Number(record.total || 0).toFixed(2), Number(record.odometro || 0).toFixed(1)].map((value) => String(value || "").trim().toLocaleLowerCase("pt-BR")).join("|");
const businessDate = (value         ) => {
  const raw = String(value || "").trim(); if (!raw) return "";
  let match = raw.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  match = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  if (/^\d{5}(?:\.\d+)?$/.test(raw)) { const date = new Date(Date.UTC(1899, 11, 30) + Number(raw) * 86400000); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10); }
  return "";
};
const todayBusinessDate = () => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
const agreementIsCanceled = (record                         ) => String(record.status || "Vigente").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR") === "cancelado";
const agreementDateConflict = (agreement                         , agreements                                ) => {
  if (agreementIsCanceled(agreement)) return undefined;
  const start = businessDate(agreement.inicio), end = agreement.fim ? businessDate(agreement.fim) : "9999-12-31";
  if (!start || !end) return undefined;
  return agreements.find((other) => {
    if (String(other.id || "") === String(agreement.id || "") || agreementIsCanceled(other)) return false;
    const otherStart = businessDate(other.inicio), otherEnd = other.fim ? businessDate(other.fim) : "9999-12-31";
    return other.postoId === agreement.postoId && other.produtoId === agreement.produtoId && !!otherStart && start <= otherEnd && otherStart <= end;
  });
};
const agreementForFueling = (agreements                                , fueling                         ) => agreements
  .filter((agreement) => {
    const date = businessDate(fueling.data), start = agreement.inicio ? businessDate(agreement.inicio) : "", end = agreement.fim ? businessDate(agreement.fim) : "9999-12-31";
    return !!date && agreement.postoId === fueling.postoId && agreement.produtoId === fueling.produtoId && ["Vigente", "Encerrado", "Vencido", "Expirado"].includes(String(agreement.status || "Vigente")) && !!start && date >= start && date <= end;
  })
  .sort((a, b) => businessDate(b.inicio).localeCompare(businessDate(a.inicio)))[0];
const fuelingAgreementIssue = (agreements                                , fueling                         ) => {
  const agreement = agreementForFueling(agreements, fueling);
  if (!agreement) return "Sem acordo válido para o posto, produto e data do abastecimento";
  return Math.abs(Number(fueling.preco || 0) - Number(agreement.preco || 0)) > .001 ? "Preço do abastecimento divergente do acordo válido na data" : "";
};
const fuelingValidationChanged = (old                                     , fueling                         ) => !old || ["data", "postoId", "produtoId", "preco", "qt", "medicaoId", "priceValidationOverride", "priceOverrideJustification"].some((key) => stable(old[key]) !== stable(fueling[key]));

export function assignAutomaticStationCodes(previous                         , next                         ) {
  const used = new Set(records(next, "postos").map((item) => String(item.codigo || "")).filter(Boolean));
  let sequence = Math.max(0, ...records(previous, "postos").map((item) => Number(String(item.codigo || "").match(/(\d+)$/)?.[1] || 0)));
  for (const station of records(next, "postos")) {
    if (station.codigo) continue;
    let code; do { code = `PST-${String(++sequence).padStart(4, "0")}`; } while (used.has(code));
    station.codigo = code; used.add(code);
  }
}

export function assignAutomaticAgreementNumbers(previous                         , next                         ) {
  const previousById = mapById(records(previous, "acordos"));
  const agreements = records(next, "acordos");
  const year = new Date().getUTCFullYear();
  const used = new Set        ();
  for (const agreement of agreements) {
    const old = previousById.get(String(agreement.id || ""));
    if (old?.numero) agreement.numero = old.numero;
    else delete agreement.numero;
    if (agreement.numero) used.add(String(agreement.numero));
  }
  let sequence = Math.max(0, ...[...used].map((number) => {
    const match = number.match(new RegExp(`^AC-${year}-(\\d+)$`, "i"));
    return Number(match?.[1] || 0);
  }));
  for (const agreement of agreements) {
    if (agreement.numero) continue;
    let number;
    do number = `AC-${year}-${String(++sequence).padStart(4, "0")}`; while (used.has(number));
    agreement.numero = number;
    used.add(number);
  }
}

// A due-date-only correction does not reapprove prices or change fiscal amounts.
function onlyDueDateCorrection(old                                     , next                         ) {
  if (!old || old.status !== next.status) return false;
  const content = (record                         ) => {
    const copy = structuredClone(record);
    for (const key of ["vencimento", "vencimentoOriginal", "vencimentoAjustado", "historico", "_meta"]) delete copy[key];
    if (Array.isArray(copy.notasFiscais)) copy.notasFiscais = copy.notasFiscais.map((value                         ) => {
      const note = {...value};
      for (const key of ["vencimento", "vencimentoOriginal", "vencimentoAjustado"]) delete note[key];
      if (Array.isArray(note.parcelas)) note.parcelas = note.parcelas.map((value                         ) => {
        const parcel = {...value}; delete parcel.vencimento; delete parcel.vencimentoOriginal; return parcel;
      });
      return note;
    });
    return copy;
  };
  return stable(content(old)) === stable(content(next));
}

export function validateBusinessRules(previous                         , next                         ) {
  const invoiceError = invoiceValidation(next, previous);
  if (invoiceError) return invoiceError;
  const previousFleet = mapById(records(previous, "frota")), fleetPlates = new Map                ();
  for (const vehicle of records(next, "frota")) {
    const id = String(vehicle.id || ""), plate = normalizedPlate(vehicle.placa), existingId = fleetPlates.get(plate);
    if (!plate || !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) return "Informe uma placa válida para cada veículo da frota.";
    if (existingId) {
      const old = previousFleet.get(id), existingOld = previousFleet.get(existingId);
      const duplicateAlreadyExisted = old && existingOld && normalizedPlate(old.placa) === plate && normalizedPlate(existingOld.placa) === plate;
      if (!duplicateAlreadyExisted) return `A placa ${plate} já está cadastrada. Cada veículo deve possuir uma placa única.`;
    }
    fleetPlates.set(plate, id);
  }
  const previousStations = mapById(records(previous, "postos")), stationCodes = new Map                (), stationTaxIds = new Map                ();
  for (const station of records(next, "postos")) {
    const taxId = String(station.cnpj || "").replace(/\D/g, ""), stationId = String(station.id || "");
    if (taxId) {
      const existingTaxId = stationTaxIds.get(taxId);
      if (existingTaxId && existingTaxId !== stationId) return "O CNPJ do posto já está cadastrado. Cada posto deve possuir um CNPJ único.";
      stationTaxIds.set(taxId, stationId);
    }
    const code = String(station.codigo || "").trim().toLocaleLowerCase("pt-BR"), id = String(station.id || ""), existingId = stationCodes.get(code);
    if (code && existingId) {
      const old = previousStations.get(id), existingOld = previousStations.get(existingId);
      if (!old || String(old.codigo || "").trim().toLocaleLowerCase("pt-BR") !== code || !existingOld || String(existingOld.codigo || "").trim().toLocaleLowerCase("pt-BR") !== code) return "O ID do posto já está em uso. Cada posto deve possuir um ID único.";
    }
    if (code) stationCodes.set(code, id);
  }
  const previousAgreements = mapById(records(previous, "acordos")), agreements = records(next, "acordos");
  for (const agreement of agreements) {
    const old = previousAgreements.get(String(agreement.id || ""));
    const manualStatus = String(agreement.status || "Vigente").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
    const start = businessDate(agreement.inicio), end = agreement.fim ? businessDate(agreement.fim) : "";
    const changed = !old || stable(old) !== stable(agreement);
    if (changed && !["vigente", "encerrado", "cancelado"].includes(manualStatus)) return "O status do acordo deve ser Vigente, Encerrado ou Cancelado.";
    // Legacy agreements may lack this field. Unrelated edits must preserve it,
    // while new agreements and explicit payment changes still require a valid value.
    const paymentChanged = !old || old.condicaoPagamento !== agreement.condicaoPagamento;
    if (paymentChanged && !["Boleto", "Depósito"].includes(String(agreement.condicaoPagamento || ""))) return "A condição de pagamento do acordo deve ser Boleto ou Depósito.";
    if (changed && !start) return "Informe uma data inicial válida para o acordo.";
    if (changed && end && end < start) return "A data final do acordo não pode ser anterior à data inicial.";
    if (changed && ["encerrado", "cancelado"].includes(manualStatus) && !end) return `Informe a data final para o acordo ${manualStatus === "encerrado" ? "encerrado" : "cancelado"}.`;
    if (changed && ["encerrado", "cancelado"].includes(manualStatus) && end > todayBusinessDate()) return "A data final de um acordo encerrado ou cancelado deve ser igual ou anterior a hoje.";
    if (changed) {
      const fiscalMappings=Array.isArray(agreement.fiscalProductMappings) ? agreement.fiscalProductMappings                                   : [];
      const codes=new Set        ();
      for (const mapping of fiscalMappings) {
        const code=String(mapping.codigoProdutoFiscal || "").trim().toUpperCase();
        if (!code) return "Informe o código fiscal em todos os itens do De/Para do acordo.";
        if (mapping.produtoDirectFuelId !== agreement.produtoId) return "O produto do De/Para deve ser o mesmo produto do acordo.";
        if (codes.has(code)) return "O mesmo código fiscal não pode aparecer duas vezes no acordo.";
        codes.add(code);
      }
    }
    const conflict = changed ? agreementDateConflict(agreement, agreements) : undefined;
    if (conflict) return `Já existe um acordo válido/vigente para este posto e produto no período informado (${String(conflict.numero || conflict.id || "acordo existente")}). Encerre o acordo existente ou ajuste as datas antes de salvar.`;
  }
  const previousFuelings = mapById(records(previous, "abastecimentos")), fuelings = records(next, "abastecimentos"), fingerprints = new Map                (), nextAgreements = records(next, "acordos");
  for (const fueling of fuelings) {
    const fingerprint = fuelingFingerprint(fueling), existingId = fingerprints.get(fingerprint), old = previousFuelings.get(String(fueling.id || ""));
    if (existingId && (!old || stable(old) !== stable(fueling) || !previousFuelings.has(existingId))) return "Este abastecimento já está cadastrado. Verifique data, hora, posto, placa, produto, quantidade, preço e odômetro.";
    const agreementIssue = fuelingAgreementIssue(nextAgreements, fueling);
    if (fuelingValidationChanged(old, fueling) && agreementIssue && (!fueling.priceValidationOverride || String(fueling.priceOverrideJustification || "").trim().length < 5)) return `${String(fueling.id)} · ${String(fueling.data)} · placa ${String(fueling.placa || "-")}: ${agreementIssue}. Preço do abastecimento: ${Number(fueling.preco || 0).toFixed(4)}; acordo ${String(agreementForFueling(nextAgreements, fueling)?.numero || agreementForFueling(nextAgreements, fueling)?.id || "não encontrado")}: ${Number(agreementForFueling(nextAgreements, fueling)?.preco || 0).toFixed(4)}. Confira o acordo ou registre uma justificativa com permissão de editar abastecimentos.`;
    fingerprints.set(fingerprint, String(fueling.id || ""));
  }
  const previousMeasurements = mapById(records(previous, "medicoes"));
  for (const measurement of records(next, "medicoes")) {
    const old = previousMeasurements.get(String(measurement.id || ""));
    if (!["Aprovada", "Confirmado"].includes(String(measurement.status)) || (["Aprovada", "Confirmado"].includes(String(old?.status)) && (stable(old) === stable(measurement) || onlyDueDateCorrection(old, measurement)))) continue;
    const itemIds = new Set(Array.isArray(measurement.itens) ? measurement.itens.map(String) : []);
    const unresolved = fuelings.filter((fueling) => itemIds.has(String(fueling.id || ""))).filter((fueling) => fuelingAgreementIssue(nextAgreements, fueling) && (!fueling.priceValidationOverride || String(fueling.priceOverrideJustification || "").trim().length < 5));
    if (unresolved.length) return `A medição não pode ser aprovada: ${unresolved.length} abastecimento(s) possui(em) pendência de acordo ou preço sem justificativa administrativa.`;
  }
  return null;
}

                                                                                                                                                                                                                              
export function analyzeChanges(previous                         , next                         ) {
  const changes                = [];
  for (const collection of BUSINESS_COLLECTIONS) {
    const before = mapById(records(previous, collection)), after = mapById(records(next, collection)); const insertedRecords = [], updatedRecords = [];
    for (const [id, record] of after) { if (!before.has(id)) insertedRecords.push(record); else if (stable(before.get(id)) !== stable(record)) updatedRecords.push(record); }
    const deleted = [...before.entries()].filter(([id]) => !after.has(id)).map(([, record]) => record);
    if (insertedRecords.length || updatedRecords.length || deleted.length) changes.push({ collection, inserted: insertedRecords.length, updated: updatedRecords.length, insertedRecords, updatedRecords, deleted });
  }
  if (stable(previous.config) !== stable(next.config)) changes.push({ collection: "config", inserted: 0, updated: 1, insertedRecords: [], updatedRecords: [], deleted: [] });
  if (stable(previous.users) !== stable(next.users)) changes.push({ collection: "users", inserted: 0, updated: 1, insertedRecords: [], updatedRecords: [], deleted: [] });
  return changes;
}

function withoutAccounting(record                                     ) {
  if (!record) return record; const copy = { ...record }; delete copy.accountingAdjustmentId; delete copy.accountingStatus; return copy;
}

function onlyRcExport(old                                     , next                         ) {
  if (!old || old.status !== "Aprovada" || next.status !== "Aprovada") return false;
  const beforeHistory = Array.isArray(old.historico) ? old.historico : [];
  const afterHistory = Array.isArray(next.historico) ? next.historico : [];
  // Export prepends one event and retains the most recent 200 entries.
  if (afterHistory.length !== Math.min(200, beforeHistory.length + 1)) return false;
  if ((afterHistory[0]                           )?.acao !== "RC SAP gerada") return false;
  if (stable(afterHistory.slice(1)) !== stable(beforeHistory.slice(0, 199))) return false;
  const content = (record                         ) => {
    const copy = { ...record };
    for (const key of ["rcSapGeradoEm", "rcSapGeradoPor", "rcSapCentroCustoOrigem", "historico"]) delete copy[key];
    return copy;
  };
  return stable(content(old)) === stable(content(next));
}

function isApprovalReopening(old                                     , next                         ) {
  if (old?.status !== "Aprovada" || next.status !== "Pendente de aprovação") return false;
  const content = (record                         ) => {
    const copy = { ...record };
    for (const key of ["status", "aprovadoPor", "aprovadoEm", "rcSapGeradoEm", "rcSapGeradoPor", "rcSapCentroCustoOrigem", "reabertoPor", "reabertoEm", "reaberturaMotivo", "historico"]) delete copy[key];
    return copy;
  };
  return stable(content(old)) === stable(content(next));
}

export function authorizeChanges(access                  , previous                         , next                         , changes               ) {
  for (const change of changes) {
    if (["users", "config"].includes(change.collection) && !access.isOwner) return `Somente o proprietário do sistema pode alterar ${change.collection}.`;
    const permission = COLLECTION_PERMISSION[change.collection];
    if (permission && change.inserted > 0 && !hasAction(access, permission, "incluir")) return `Seu perfil não permite incluir registros em ${change.collection}.`;
    if (permission && change.updated > 0 && !hasAction(access, permission, "editar") && !(change.collection === "sapReturns" && hasAction(access,"medicoes","excluir") && change.updatedRecords.every(r=>r.voided===true)) && !(change.collection === "medicoes" && isAdmin(access) && hasAction(access, "medicoes", "excluir") && change.updatedRecords.every(record => isApprovalReopening(mapById(records(previous, "medicoes")).get(String(record.id || "")), record))) && !(change.collection === "medicoes" && hasAction(access, "medicoes", "exportar") && change.updatedRecords.every(record => onlyRcExport(mapById(records(previous, "medicoes")).get(String(record.id || "")), record)))) return `Seu perfil não permite editar registros em ${change.collection}.`;
    if (permission && change.deleted.length > 0 && !hasAction(access, permission, "excluir")) return `Seu perfil não permite excluir registros em ${change.collection}.`;
    if (change.collection === "fiscalLayouts") {
      if (change.deleted.length) return "O histórico de layouts não pode ser excluído; desative a versão.";
      const existing=mapById(records(previous,"fiscalLayouts"));
      const immutable=(row                        )=>{const copy={...row};delete copy.active;delete copy.history;delete copy._meta;return copy;};
      for(const row of change.updatedRecords){const old=existing.get(String(row.id)) ;if(stable(immutable(old))!==stable(immutable(row)))return "As versões de layout são imutáveis. Crie uma nova versão.";const before=Array.isArray(old.history)?old.history:[],after=Array.isArray(row.history)?row.history:[];if(stable(after.slice(0,before.length))!==stable(before)||after.length<=before.length)return "Preserve o histórico e registre a alteração de ativação.";}
      for(const row of [...change.insertedRecords,...change.updatedRecords]){
        const old=existing.get(String(row.id)),rule=row.rules                          ,reference=row.reference                          ,test=row.test                          ;
        if(!rule||!reference||!test||!String(row.name||"").trim()||String(row.reason||"").trim().length<5||!Number.isInteger(row.version)||Number(row.version)<1||!/^L1-[a-f0-9]+$/.test(String(row.fingerprint))||!["draft","validated"].includes(String(row.status))||typeof row.active!=="boolean")return "Dados do layout inválidos.";
        if(!["auto","second","fourth"].includes(String(rule.totalColumn))||["dueAnchor","issuerStart","issuerEnd"].some(key=>typeof rule[key]!=="string"||String(rule[key]).length>100)||!!rule.issuerStart!==!!rule.issuerEnd)return "Regras de leitura do layout inválidas.";
        if(["allowMissingDue","numericUnit"].some(k=>rule[k]!==undefined&&typeof rule[k]!=="boolean"))return "Opções de leitura do layout inválidas.";
        if(!/^NF_LAYOUT_[A-Za-z0-9_-]+$/.test(String(reference.documentId))||!String(reference.filename||"").trim()||!/^[a-f0-9]{64}$/.test(String(reference.sha256)))return "Informe um PDF de referência válido para o layout.";
        if(!old){const station=records(next,"postos").find(item=>item.id===row.stationId);if(!station||String(station.cnpj||"").replace(/\D/g,"")!==row.cnpj||!/^\d{14}$/.test(String(row.cnpj)))return "O CNPJ do layout deve corresponder ao posto.";if(row.active)return "Salve a versão antes de ativá-la.";const maximum=Math.max(0,...records(previous,"fiscalLayouts").filter(item=>item.cnpj===row.cnpj&&item.fingerprint===row.fingerprint).map(item=>Number(item.version)));if(Number(row.version)!==maximum+1)return "A versão do layout mudou. Atualize antes de salvar.";}
        if(row.status==="validated"&&(test.passed!==true||test.confirmed!==true||!Array.isArray(test.errors)||test.errors.length))return "O layout deve passar pela validação antes da ativação.";
        if(row.active&&!old?.active){if(!hasAction(access,"postos","aprovar"))return "Seu acesso não permite ativar layouts de NF.";if(row.status!=="validated")return "Valide o layout antes de ativá-lo.";}
      }
      const active=new Set        (),versions=new Set        ();for(const row of records(next,"fiscalLayouts")){const key=`${row.cnpj}:${row.fingerprint}`,version=`${key}:${row.version}`;if(versions.has(version))return "Versão de layout duplicada.";versions.add(version);if(row.active){if(active.has(key))return "Somente uma versão pode estar ativa por CNPJ e formato.";active.add(key);}}
    }
    if (change.collection === "medicoes") {
      const beforeMeasurements = mapById(records(previous, "medicoes"));
      for (const measurement of change.updatedRecords) {
        const old = beforeMeasurements.get(String(measurement.id || ""));
        if (old?.status === "Aprovada" && measurement.status !== "Aprovada") {
          if (!isAdmin(access) || !hasAction(access, "medicoes", "excluir")) return "É necessário ser Administrador com permissão de excluir medições para desfazer a aprovação.";
          if (!isApprovalReopening(old, measurement)) return "Reabra a aprovação sem alterar as NFs ou os abastecimentos vinculados.";
          if (old.accountingAdjustmentId || records(previous, "accountingAdjustments").some(item => Array.isArray(item.measurementIds) && item.measurementIds.map(String).includes(String(measurement.id)))) return "Desfaça a contabilização antes de reabrir a aprovação.";
          if (String(measurement.reaberturaMotivo || "").trim().length < 5) return "Informe o motivo da reabertura da aprovação.";
        }
      }
      const approved = [...change.insertedRecords, ...change.updatedRecords].some((measurement) => { const before=String(beforeMeasurements.get(String(measurement.id || ""))?.status || ""),after=String(measurement.status || "");return (after==="Aprovada"&&before!=="Aprovada")||(after==="Confirmado"&&!["Aprovada","Confirmado"].includes(before))||(after!==before&&["Rejeitada","Devolvida para pendentes"].includes(after)); });
      if (approved && !hasAction(access, "medicoes", "aprovar")) return "Seu perfil não permite aprovar medições.";
      const accountingChanged = [...change.insertedRecords, ...change.updatedRecords].some((measurement) => {
        const old = beforeMeasurements.get(String(measurement.id || ""));
        return stable(old?.accountingAdjustmentId) !== stable(measurement.accountingAdjustmentId) && !!measurement.accountingAdjustmentId;
      });
      if (accountingChanged && [...change.insertedRecords, ...change.updatedRecords].some((measurement) => measurement.accountingAdjustmentId && String(measurement.status || "") !== "Aprovada")) return "Somente medições aprovadas podem seguir para contabilização.";
    }
    if (change.collection === "sapReturns") {
      if (change.deleted.length) return "Preserve o histórico; exclua somente o vínculo da RC.";
      const existing=mapById(records(previous,"sapReturns"));
      const immutable=(r                        )=>{const c={...r};for(const k of ["requisition","voided","adjustments","_meta"])delete c[k];return c;};
      for(const row of change.updatedRecords){
        const old=existing.get(String(row.id)) ;
        if(old.voided||stable(immutable(old))!==stable(immutable(row)))return "Preserve os dados originais do retorno SAP.";
        const deleting=row.voided===true;
        if(!hasAction(access,"medicoes",deleting?"excluir":"editar"))return "Seu perfil não permite ajustar este vínculo SAP.";
        if(deleting?row.requisition!==old.requisition:row.voided!==old.voided||old.purchaseOrder||old.status!=="success"||!/^\d{1,20}$/.test(String(row.requisition))||row.requisition===old.requisition)return "Alteração de vínculo SAP inválida.";
        const before=Array.isArray(old.adjustments)?old.adjustments:[],after=Array.isArray(row.adjustments)?row.adjustments:[],event=after[after.length-1]                          ;
        const oldRelation=old.purchaseOrder||old.requisition;
        if(after.length!==before.length+1||stable(after.slice(0,-1))!==stable(before)||!event||String(event.reason||"").trim().length<5||!event.at||!event.by||event.from!==oldRelation||event.to!==(deleting?"":row.requisition)||event.action!==(deleting?"delete":"edit"))return "Registre o motivo e preserve o histórico do vínculo SAP.";
      }

      const key=(value         )=>String(value||"").trim().split("-").map(v=>v.replace(/^0+(?=\d)/,"")).join("-");
      const all=records(next,"sapReturns").filter(r=>!r.voided);
      for (const row of change.insertedRecords) {
        if(row.voided||(Array.isArray(row.adjustments)&&row.adjustments.length))return "Novo retorno SAP não pode conter ajustes anteriores.";
        const med=records(next,"medicoes").find(m=>m.id===row.measurementId);
        const notes=Array.isArray(med?.notasFiscais)?med.notasFiscais                            :[];
        const matches=notes.filter(n=>key(`${n.numero}-${n.serie}`)===row.invoiceKey);
        if (!med || med.status!=="Aprovada" || matches.length!==1) return "Vincule o retorno a uma única NF de medição aprovada.";
        const supplier=records(next,"postos").find(p=>p.id===med.postoId);
        if(row.source==="sap-purchase-report" || row.source==="manual-purchase"){
          const note=matches[0],invoiceNumber=key(note.numero),postingDateRaw=String(row.postingDate||"").trim(),postingDate=postingDateRaw?businessDate(postingDateRaw):"",purchaseOrder=String(row.purchaseOrder||"").trim();
          if(key(supplier?.sap)!==row.supplier||invoiceNumber!==row.invoiceNumber)return "Fornecedor ou número da NF divergente do relatório SAP.";
          if(!/^\d{1,20}$/.test(purchaseOrder)||(postingDateRaw&&(!postingDate||postingDate!==postingDateRaw))||row.status!=="success")return "Pedido de Compra ou data de lançamento SAP inválida.";
          if(!row.message||!row.filename||!row.importedAt||!Array.isArray(row.sourceRows)||!row.sourceRows.length)return "Vínculo SAP incompleto.";
          if(all.some(r=>r.id!==row.id&&!r.voided&&r.purchaseOrder&&r.measurementId===row.measurementId&&r.invoiceKey===row.invoiceKey&&String(r.purchaseOrder)===purchaseOrder&&r.postingDate===postingDate))return "Pedido de Compra e lançamento SAP já vinculados a esta NF.";
          const priorPurchases=all.filter(r=>r.id!==row.id&&!r.voided&&r.purchaseOrder&&r.measurementId===row.measurementId&&r.invoiceKey===row.invoiceKey);
          if(priorPurchases.some(r=>String(r.purchaseOrder)!==purchaseOrder))return "Esta NF já possui pedido de compra diferente vinculado. Confira o Histórico SAP.";
          if(postingDateRaw&&priorPurchases.some(r=>businessDate(r.postingDate)))return "Esta NF já possui data de lançamento SAP. Confira o Histórico SAP.";
          if(row.source==="manual-purchase") {
            if(row.confirmed!==true || String(row.reason||"").trim().length<5) return "Confirme a conferência no SAP e informe uma observação para o vínculo manual.";
          }
          continue;
        }
        if(key(supplier?.sap)!==row.supplier || String(matches[0].emissao||matches[0].dataEmissao||"").slice(0,10)!==row.date) return "Fornecedor ou emissão divergente da NF.";
        const fuels=records(next,"abastecimentos").filter(a=>Array.isArray(med.itens)&&med.itens.includes(a.id)&&(notes.length===1||(Array.isArray(matches[0].abastecimentoIds)&&matches[0].abastecimentoIds.includes(a.id))));
        const signature=(a                        )=>{const product=records(next,"produtos").find(p=>p.id===a.produtoId), unit=records(next,"unidades").find(u=>u.id===(a.unidadeId||(Array.isArray(med.unidadeIds)&&med.unidadeIds.length===1?med.unidadeIds[0]:"")));return JSON.stringify([key(product?.sap),String(unit?.centroSap||"").trim(),Number(a.qt),Number(a.preco)]);};
        const expectedSignature=JSON.stringify([key(row.material),String(row.centro||"").trim(),Number(row.quantidade),Number(row.preco)]);
        const matching=fuels.filter(a=>signature(a)===expectedSignature);
        if(row.signature!==expectedSignature||!matching.length)return "Linha SAP divergente dos abastecimentos da NF.";
        if(row.status==="success"&&all.filter(r=>r.status==="success"&&r.measurementId===row.measurementId&&r.invoiceKey===row.invoiceKey&&r.signature===row.signature).length>matching.length)return "A NF já possui retorno de sucesso para esta linha.";
        if(["manual","manual-batch"].includes(String(row.source))&&(row.confirmed!==true||String(row.reason||"").trim().length<5))return "Confirme o vínculo manual e informe sua observação.";
        if(!row.message||!row.filename||!row.signature||!row.importedAt||!["success","error"].includes(String(row.status)))return "Retorno SAP incompleto.";
        const requisition=String(row.message).match(/^Requisi[çc][ãa]o de compra criada sob n[º°o.]?\s*(\d+)\s*$/i)?.[1]||"";
        if(requisition!==row.requisition||(row.status==="success")!==Boolean(requisition))return "Requisição incompatível com a mensagem SAP.";
        if(row.source==="manual-batch"){
          if(records(previous,"sapReturns").some(r=>!r.voided&&r.measurementId===row.measurementId&&r.invoiceKey===row.invoiceKey))return "Somente NFs Sem Lançamento podem ser relacionadas em lote.";
          if(!/^\d{1,20}$/.test(String(row.requisition))||!/^\d+$/.test(String(row.lineKey))||!fuels[Number(row.lineKey)]||signature(fuels[Number(row.lineKey)])!==row.signature)return "Linha inválida no vínculo em lote.";
          const batchRows=all.filter(r=>r.source==="manual-batch"&&r.measurementId===row.measurementId&&r.invoiceKey===row.invoiceKey);
          if(batchRows.length!==fuels.length||new Set(batchRows.map(r=>String(r.lineKey))).size!==fuels.length||new Set(batchRows.map(r=>r.requisition)).size!==1)return "Vincule todas as linhas da NF à mesma RC.";
        }
        if(row.source!=="manual-batch"&&all.some(r=>r.id!==row.id&&r.requisition&&r.requisition===row.requisition&&(r.measurementId!==row.measurementId||r.invoiceKey!==row.invoiceKey)))return "Requisição já vinculada a outra NF.";
        if(all.some(r=>r.id!==row.id&&r.measurementId===row.measurementId&&r.invoiceKey===row.invoiceKey&&r.signature===row.signature&&r.message===row.message&&String(r.lineKey||"")===String(row.lineKey||"")))return "Retorno SAP duplicado.";
      }
    }
    if (change.collection === "accountingAdjustments") {
      const measurements = mapById(records(next, "medicoes"));
      const hasUnapproved = [...change.insertedRecords, ...change.updatedRecords].some((adjustment) => {
        const measurementIds = Array.isArray(adjustment.measurementIds) ? adjustment.measurementIds.map(String) : [];
        return !measurementIds.length || measurementIds.some((id) => String(measurements.get(id)?.status || "") !== "Aprovada");
      });
      if (hasUnapproved) return "Somente medições aprovadas podem seguir para contabilização.";
    }
  }
  if (!hasAction(access, "abastecimentos", "editar")) {
    const beforeFuelings = mapById(records(previous, "abastecimentos"));
    for (const fueling of records(next, "abastecimentos")) {
      const old = beforeFuelings.get(String(fueling.id || ""));
      if ((!old || stable(old) !== stable(fueling)) && fueling.priceValidationOverride && (!old || stable({ override: old.priceValidationOverride, justification: old.priceOverrideJustification }) !== stable({ override: fueling.priceValidationOverride, justification: fueling.priceOverrideJustification }))) return "Seu acesso não permite editar abastecimentos para justificar divergências de acordo ou preço.";
    }
  }
  if (!isMaster(access)) {
    const beforeMeasurements = mapById(records(previous, "medicoes"));
    for (const measurement of records(next, "medicoes")) {
      const old = beforeMeasurements.get(String(measurement.id || ""));
      if (!["Aprovada", "Confirmado"].includes(String(old?.status)) || stable(withoutAccounting(old)) === stable(withoutAccounting(measurement))) continue;
      if (onlyRcExport(old, measurement)) {
        if (!hasAction(access, "medicoes", "exportar")) return "Seu perfil não permite exportar RC SAP.";
        continue;
      }
      if (isApprovalReopening(old, measurement) && isAdmin(access) && hasAction(access, "medicoes", "excluir")) continue;
      if (hasAction(access, "medicoes", "editar")) continue;
      return "Seu acesso não permite editar uma medição confirmada.";
    }
  }
  // The shared state legitimately contains the owner's Master record.
  // User changes are protected above; the state API also preserves users for
  // non-owners and rejects Master assignments to anyone outside OWNER_EMAILS.
  return null;
}

export function validateState(value         ) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Estado inválido.";
  const state = value                           ;
  for (const key of BUSINESS_COLLECTIONS) {
    if (state[key] !== undefined && !Array.isArray(state[key])) return `${key} deve ser uma lista.`;
    const list = records(state, key); if (list.length > 100_000) return `${key} excedeu o limite de registros.`;
    const ids = new Set        (); for (const record of list) { const id = String(record.id || ""); if (!id || id.length > 120 || ids.has(id)) return `Identificador inválido ou duplicado em ${key}.`; ids.add(id); }
  }
  const unsafeMarkup = /<(?:script|iframe|object|embed|svg)|on\w+\s*=|javascript:/i;
  const visit = (entry         )          => { if (typeof entry === "string") return entry.length <= 20_000 && !unsafeMarkup.test(entry); if (Array.isArray(entry)) return entry.every(visit); if (entry && typeof entry === "object") return Object.values(entry                           ).every(visit); return true; };
  return visit(state) ? null : "O conteúdo possui texto inválido ou acima do limite permitido.";
}

export function securityEvents(changes               , email        , version        , now        ) {
  return changes.map((change) => ({ id: crypto.randomUUID(), data: now, usuario: email, acao: "Alteração validada", entidade: change.collection, registro: "", detalhe: `${change.inserted} inclusão(ões), ${change.updated} alteração(ões), ${change.deleted.length} exclusão(ões)`, version }));
}
