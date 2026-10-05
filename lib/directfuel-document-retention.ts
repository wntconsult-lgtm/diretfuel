type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
const text = (value: unknown) => String(value ?? "").trim();
const code = (value: unknown) => text(value).replace(/^0+(?=\d)/, "");

export const DEFAULT_DOCUMENT_RETENTION_DAYS = 180;
export const MIN_DOCUMENT_RETENTION_DAYS = 7;
export const MAX_DOCUMENT_RETENTION_DAYS = 3650;

export type DocumentRetentionPolicy = {
  removePdf: boolean;
  removeXml: boolean;
  compactFiscalDetails: boolean;
};

function params(state: Row) {
  const config = state.config && typeof state.config === "object" && !Array.isArray(state.config) ? state.config as Row : {};
  return config.params && typeof config.params === "object" && !Array.isArray(config.params) ? config.params as Row : {};
}

export function retentionDays(state: Row) {
  const configured = Number(params(state).documentRetentionDays);
  if (!Number.isFinite(configured)) return DEFAULT_DOCUMENT_RETENTION_DAYS;
  return Math.min(MAX_DOCUMENT_RETENTION_DAYS, Math.max(MIN_DOCUMENT_RETENTION_DAYS, Math.round(configured)));
}

export function retentionPolicy(state: Row): DocumentRetentionPolicy {
  const configured = params(state).documentRetentionPolicy;
  const policy = configured && typeof configured === "object" && !Array.isArray(configured) ? configured as Row : {};
  return {
    removePdf: policy.removePdf !== false,
    removeXml: policy.removeXml !== false,
    compactFiscalDetails: policy.compactFiscalDetails !== false,
  };
}

function noteKey(note: Row) {
  return `${note.numero || ""}-${note.serie || ""}`.split("-").map(code).join("-");
}

function compactNote(note: Row, archivedAt: string, archivedBy: string, policy: DocumentRetentionPolicy) {
  const keep = [
    "id", "numero", "serie", "chave", "cnpjEmitente", "razaoSocial", "emissao",
    "vencimento", "dataSaida", "quantidadeTotal", "valorTotal", "postoId", "postoStatus",
    "abastecimentoIds", "conferencia", "conferenciaConfirmada", "conferidaPor", "conferidaEm", "confirmada", "vinculoManual",
    "ajusteDescontoTotal", "descontoTotal", "observacao",
  ];
  const compacted: Row = {};
  for (const key of keep) if (note[key] !== undefined) compacted[key] = note[key];
  compacted.arquivada = true;
  compacted.conferenciaConfirmada = true;
  compacted.arquivadaEm = archivedAt;
  compacted.arquivadaPor = archivedBy;
  compacted.consultaExternaPelaChave = Boolean(text(note.chave));
  compacted.detalhesCompactadosEm = archivedAt;
  if (!policy.removePdf) for (const key of ["pdfDocumento", "documentoPdfId", "pdfNome", "pdfPaginaInicial", "pdfPaginaFinal"]) if (note[key] !== undefined) compacted[key] = note[key];
  if (!policy.removeXml) for (const key of ["xmlDocumento", "xmlNome"]) if (note[key] !== undefined) compacted[key] = note[key];
  return compacted;
}

export type RetentionPlan = {
  state: Row;
  retentionDays: number;
  policy: DocumentRetentionPolicy;
  cutoff: string;
  notes: number;
  measurements: number;
  pdfIds: string[];
  xmlIds: string[];
  beforeBytes: number;
  afterBytes: number;
  savedBytes: number;
};

export function planDocumentRetention(state: Row, now: Date, archivedBy = "Sistema"): RetentionPlan {
  const days = retentionDays(state);
  const policy = retentionPolicy(state);
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const postings = rows(state.sapReturns).filter(record => !record.voided && record.status === "success" && record.purchaseOrder && /^\d{4}-\d{2}-\d{2}/.test(text(record.postingDate)));
  const eligible = new Set<string>();
  const pdfEligible = new Set<string>();
  const measurementIds = new Set<string>();
  const references = new Map<string, { total: number; eligible: number }>();

  rows(state.medicoes).forEach((measurement, measurementIndex) => {
    rows(measurement.notasFiscais).forEach((note, noteIndex) => {
      const pdfId = text(note.documentoPdfId || (note.pdfDocumento ? note.id : ""));
      if (pdfId && !pdfId.startsWith("NF_LAYOUT_")) {
        const count = references.get(pdfId) || { total: 0, eligible: 0 };
        count.total += 1;
        references.set(pdfId, count);
      }
      if (measurement.status !== "Aprovada") return;
      if (!/^\d{44}$/.test(text(note.chave || note.chaveNfe).replace(/\D/g, ""))) return;
      const key = noteKey(note);
      const posted = postings.some(record => String(record.measurementId) === String(measurement.id) && text(record.invoiceKey) === key && text(record.postingDate).slice(0, 10) <= cutoff);
      if (!posted) return;
      const pendingPdf = policy.removePdf && Boolean(pdfId) && !note.documentoPdfRemovido;
      const pendingXml = policy.removeXml && Boolean(note.xmlDocumento) && !note.documentoXmlRemovido;
      const pendingDetails = policy.compactFiscalDetails && !note.arquivada;
      if (!pendingPdf && !pendingXml && !pendingDetails) return;
      eligible.add(`${measurementIndex}:${noteIndex}`);
      measurementIds.add(String(measurement.id));
      if (pendingPdf && pdfId && !pdfId.startsWith("NF_LAYOUT_")) {
        pdfEligible.add(`${measurementIndex}:${noteIndex}`);
        const count = references.get(pdfId)!;
        count.eligible += 1;
      }
    });
  });

  const archivedAt = now.toISOString();
  const next: Row = structuredClone(state);
  const pdfIds = policy.removePdf ? [...references].filter(([, count]) => count.total === count.eligible && count.eligible > 0).map(([id]) => id) : [];
  const pdfSet = new Set(pdfIds);
  const xmlIds = new Set<string>();
  rows(next.medicoes).forEach((measurement, measurementIndex) => {
    measurement.notasFiscais = rows(measurement.notasFiscais).map((note, noteIndex) => {
      if (!eligible.has(`${measurementIndex}:${noteIndex}`)) return note;
      const originalPdfId = text(note.documentoPdfId || (note.pdfDocumento ? note.id : ""));
      const pendingDetails = policy.compactFiscalDetails && !note.arquivada;
      const updated = pendingDetails ? compactNote(note, archivedAt, archivedBy, policy) : { ...note };
      updated.retencaoAplicadaEm = archivedAt;
      updated.retencaoAplicadaPor = archivedBy;
      if (policy.removePdf && pdfEligible.has(`${measurementIndex}:${noteIndex}`) && pdfSet.has(originalPdfId)) {
        delete updated.pdfDocumento; delete updated.documentoPdfId; delete updated.pdfNome; delete updated.pdfPaginaInicial; delete updated.pdfPaginaFinal;
        updated.documentoPdfRemovido = true;
        updated.pdfRemovidoEm = archivedAt;
      }
      if (policy.removeXml && note.xmlDocumento && note.id && !text(note.id).startsWith("NF_LAYOUT_")) {
        xmlIds.add(text(note.id)); delete updated.xmlDocumento; delete updated.xmlNome;
        updated.documentoXmlRemovido = true;
        updated.xmlRemovidoEm = archivedAt;
      }
      return updated;
    });
  });
  const beforeBytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
  const afterBytes = new TextEncoder().encode(JSON.stringify(next)).byteLength;
  return { state: next, retentionDays: days, policy, cutoff, notes: eligible.size, measurements: measurementIds.size, pdfIds, xmlIds: [...xmlIds], beforeBytes, afterBytes, savedBytes: Math.max(0, beforeBytes - afterBytes) };
}
