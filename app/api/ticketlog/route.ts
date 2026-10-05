import { env } from "cloudflare:workers";
import { requireVixparUser, WORKSPACE_ID } from "@/lib/directfuel-access";
import { hasAction, hasPermission, isAdmin } from "@/lib/directfuel-security";
import { cleanupPreviousTicketlogImports } from "@/lib/directfuel-ticketlog-cleanup";

export const dynamic = "force-dynamic";

type InputRecord = Record<string, unknown>;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

const clean = (value: unknown, max = 300) => String(value ?? "").trim().slice(0, max);
const upper = (value: unknown, max = 80) => clean(value, max).toUpperCase().replace(/\s+/g, "");
const number = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = clean(value, 60);
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};
const coordinate = (value: unknown, limit: 90 | 180) => {
  const parsed = number(value);
  if (!parsed) return 0;
  if (Math.abs(parsed) <= limit) return parsed;
  if (Number.isInteger(parsed) && Math.abs(parsed) >= 1_000_000) {
    const scaled = parsed / 1_000_000;
    if (Math.abs(scaled) <= limit) return scaled;
  }
  return 0;
};
const isoDate = (value: unknown) => {
  const raw = clean(value, 30);
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return "";
};

export async function GET(request: Request) {
  const access = await requireVixparUser();
  if ("error" in access) return Response.json({ error: access.error }, { status: access.status });
  if (new URL(request.url).searchParams.get("report") === "stations") {
    if (!hasPermission(access, "relatorios")) return Response.json({error:"Acesso aos relatórios não autorizado."},{status:403});
    const offset=Math.max(0,Math.floor(Number(new URL(request.url).searchParams.get("offset"))||0));
    const result=await env.DB.prepare("SELECT id, source_code, name, cnpj, address, neighborhood, city, uf, cep, latitude, longitude, geocode_status, active, created_at, created_by, updated_at, updated_by FROM ticketlog_stations WHERE workspace_id = ? ORDER BY name, id LIMIT 1000 OFFSET ?").bind(WORKSPACE_ID,offset).all();
    return Response.json({stations:result.results,nextOffset:result.results.length===1000?offset+1000:null},{headers:{"cache-control":"private, no-store"}});
  }
  if (!hasPermission(access, "ticketlog_import") && !hasPermission(access, "analysis_geo")) return Response.json({ error: "Acesso aos dados Ticketlog não autorizado." }, { status: 403 });
  try {
    const search = new URL(request.url).searchParams;
    const dateFilter = (name: string) => { const value = clean(search.get(name), 10); return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""; };
    const fuelingFrom = dateFilter("fuelingFrom"), fuelingTo = dateFilter("fuelingTo"), batchFrom = dateFilter("batchFrom"), batchTo = dateFilter("batchTo");
    if (fuelingFrom && fuelingTo && fuelingFrom > fuelingTo) return Response.json({ error: "A data inicial dos abastecimentos deve ser anterior à data final." }, { status: 400 });
    if (batchFrom && batchTo && batchFrom > batchTo) return Response.json({ error: "A data inicial das cargas deve ser anterior à data final." }, { status: 400 });
    await cleanupPreviousTicketlogImports(env.DB, env.BUCKET, access);
    const [summary, stationSummary, stations, recent, pendingPlates, batches] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS records, COALESCE(SUM(liters), 0) AS liters, COALESCE(SUM(final_value), 0) AS value,
        SUM(CASE WHEN vehicle_link_status = 'Vinculado' THEN 1 ELSE 0 END) AS linked,
        SUM(CASE WHEN vehicle_link_status != 'Vinculado' THEN 1 ELSE 0 END) AS pending,
        COUNT(DISTINCT CASE WHEN vehicle_link_status != 'Vinculado' THEN UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(plate, '-', ''), ' ', ''), '.', ''), '/', ''), '_', '')) END) AS pending_plates,
        MIN(occurred_on) AS first_date, MAX(occurred_on) AS last_date
        FROM ticketlog_fuelings WHERE workspace_id = ?`).bind(WORKSPACE_ID).first(),
      env.DB.prepare(`SELECT COUNT(*) AS records,
        SUM(CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 ELSE 0 END) AS pending_geocode,
        SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) AS geocoded
        FROM ticketlog_stations WHERE workspace_id = ?`).bind(WORKSPACE_ID).first(),
      env.DB.prepare("SELECT id, source_code, name, cnpj, address, neighborhood, city, uf, cep, latitude, longitude, geocode_status, active, updated_at, updated_by FROM ticketlog_stations WHERE workspace_id = ? ORDER BY name LIMIT 2000").bind(WORKSPACE_ID).all(),
      env.DB.prepare("SELECT id, transaction_code, occurred_on, occurred_time, plate, service, product, liters, final_price, final_value, station_code, station_name, city, uf, vehicle_link_status, import_batch_id, imported_at FROM ticketlog_fuelings WHERE workspace_id = ? AND (? = '' OR occurred_on >= ?) AND (? = '' OR occurred_on <= ?) ORDER BY occurred_on DESC, occurred_time DESC, transaction_code DESC LIMIT 500").bind(WORKSPACE_ID, fuelingFrom, fuelingFrom, fuelingTo, fuelingTo).all(),
      env.DB.prepare(`SELECT UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(plate, '-', ''), ' ', ''), '.', ''), '/', ''), '_', '')) AS plate,
        MAX(vehicle_model) AS vehicle_model, COUNT(*) AS records, COALESCE(SUM(liters), 0) AS liters,
        MIN(occurred_on) AS first_date, MAX(occurred_on) AS last_date
        FROM ticketlog_fuelings WHERE workspace_id = ? AND vehicle_link_status != 'Vinculado'
        GROUP BY UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(plate, '-', ''), ' ', ''), '.', ''), '/', ''), '_', ''))
        ORDER BY records DESC, plate LIMIT 200`).bind(WORKSPACE_ID).all(),
      env.DB.prepare(`SELECT b.id, b.kind, b.filename, b.imported, b.duplicated, b.updated, b.rejected, b.created_at, b.created_by,
        (SELECT COUNT(*) FROM ticketlog_fuelings f WHERE f.workspace_id = b.workspace_id AND f.import_batch_id = b.id) AS current_records,
        (SELECT COALESCE(SUM(f.liters), 0) FROM ticketlog_fuelings f WHERE f.workspace_id = b.workspace_id AND f.import_batch_id = b.id) AS current_liters
        FROM ticketlog_import_batches b WHERE b.workspace_id = ? AND (? = '' OR substr(b.created_at, 1, 10) >= ?) AND (? = '' OR substr(b.created_at, 1, 10) <= ?) ORDER BY b.created_at DESC LIMIT 200`).bind(WORKSPACE_ID, batchFrom, batchFrom, batchTo, batchTo).all(),
    ]);
    return Response.json({ summary, stationSummary, stations: stations.results, recent: recent.results, pendingPlates: pendingPlates.results, batches: batches.results, filters: { fuelingFrom, fuelingTo, batchFrom, batchTo }, canReprocessLinks: hasAction(access, "analysis_geo", "editar"), canDelete: hasAction(access, "ticketlog_import", "excluir") }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("Ticketlog data read failed", error);
    return Response.json({ error: "Não foi possível carregar os dados Ticketlog." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const access = await requireVixparUser();
  if ("error" in access) return Response.json({ error: access.error }, { status: access.status });
  if (!sameOrigin(request)) return Response.json({ error: "Origem da solicitação não autorizada." }, { status: 403 });
  try {
    const body = await request.json() as { action?: string; kind?: string; batchId?: string; fuelingId?: string; filename?: string; records?: InputRecord[]; totals?: { imported?: number; duplicated?: number; updated?: number; rejected?: number } };
    if (body.action === "delete-fueling" || body.action === "delete-batch") {
      if (!hasAction(access, "ticketlog_import", "excluir")) return Response.json({ error: "É necessária permissão de excluir dados Ticketlog." }, { status: 403 });
      const now = new Date().toISOString();
      if (body.action === "delete-fueling") {
        const fuelingId = clean(body.fuelingId, 80);
        if (!fuelingId) return Response.json({ error: "Abastecimento inválido." }, { status: 400 });
        const fueling = await env.DB.prepare("SELECT id, transaction_code, liters, import_batch_id FROM ticketlog_fuelings WHERE workspace_id = ? AND id = ?").bind(WORKSPACE_ID, fuelingId).first<{ id: string; transaction_code: string; liters: number; import_batch_id: string }>();
        if (!fueling) return Response.json({ error: "Abastecimento não encontrado ou já excluído." }, { status: 404 });
        await env.DB.batch([
          env.DB.prepare("DELETE FROM volume_reviews WHERE workspace_id = ? AND record_key = ?").bind(WORKSPACE_ID, `ticket:${fueling.transaction_code}`),
          env.DB.prepare("DELETE FROM ticketlog_fuelings WHERE workspace_id = ? AND id = ?").bind(WORKSPACE_ID, fueling.id),
          env.DB.prepare("INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), WORKSPACE_ID, now, access.user.email, "Exclusão individual Ticketlog", "Abastecimento Ticketlog", `Transação ${fueling.transaction_code}; lote ${fueling.import_batch_id}; ${Number(fueling.liters || 0).toLocaleString("pt-BR")} L`, 0),
        ]);
        return Response.json({ ok: true, deleted: 1, liters: Number(fueling.liters || 0), transactionCode: fueling.transaction_code });
      }
      const batchId = clean(body.batchId, 80);
      if (!batchId) return Response.json({ error: "Carga inválida." }, { status: 400 });
      const batch = await env.DB.prepare("SELECT id, kind, filename FROM ticketlog_import_batches WHERE workspace_id = ? AND id = ?").bind(WORKSPACE_ID, batchId).first<{ id: string; kind: string; filename: string }>();
      if (!batch) return Response.json({ error: "Carga não encontrada ou já excluída." }, { status: 404 });
      if (batch.kind !== "fuelings") return Response.json({ error: "A exclusão completa está disponível somente para cargas de abastecimentos. Postos devem ser corrigidos por uma nova carga." }, { status: 409 });
      const impact = await env.DB.prepare("SELECT COUNT(*) AS records, COALESCE(SUM(liters), 0) AS liters FROM ticketlog_fuelings WHERE workspace_id = ? AND import_batch_id = ?").bind(WORKSPACE_ID, batch.id).first<{ records: number; liters: number }>();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM volume_reviews WHERE workspace_id = ? AND record_key IN (SELECT 'ticket:' || transaction_code FROM ticketlog_fuelings WHERE workspace_id = ? AND import_batch_id = ?)").bind(WORKSPACE_ID, WORKSPACE_ID, batch.id),
        env.DB.prepare("DELETE FROM ticketlog_fuelings WHERE workspace_id = ? AND import_batch_id = ?").bind(WORKSPACE_ID, batch.id),
        env.DB.prepare("DELETE FROM ticketlog_import_batches WHERE workspace_id = ? AND id = ?").bind(WORKSPACE_ID, batch.id),
        env.DB.prepare("INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), WORKSPACE_ID, now, access.user.email, "Exclusão de carga Ticketlog", "Carga de abastecimentos Ticketlog", `${batch.filename}; ${Number(impact?.records || 0)} abastecimentos; ${Number(impact?.liters || 0).toLocaleString("pt-BR")} L`, 0),
      ]);
      return Response.json({ ok: true, deleted: Number(impact?.records || 0), liters: Number(impact?.liters || 0), filename: batch.filename });
    }
    if (!hasAction(access, "ticketlog_import", "incluir")) return Response.json({ error: "Seu perfil não possui permissão para importar dados Ticketlog." }, { status: 403 });
    const kind = body.kind === "stations" ? "stations" : body.kind === "fuelings" ? "fuelings" : "";
    const batchId = clean(body.batchId, 80);
    if (!kind || !batchId) return Response.json({ error: "Tipo ou lote de importação inválido." }, { status: 400 });

    if (body.action === "finish") {
      const totals = body.totals || {}, now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO ticketlog_import_batches (id, workspace_id, kind, filename, imported, duplicated, updated, rejected, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(batchId, WORKSPACE_ID, kind, clean(body.filename, 220) || "carga.csv", Math.max(0, Number(totals.imported || 0)), Math.max(0, Number(totals.duplicated || 0)), Math.max(0, Number(totals.updated || 0)), Math.max(0, Number(totals.rejected || 0)), now, access.user.email),
        env.DB.prepare("INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), WORKSPACE_ID, now, access.user.email, "Importação Ticketlog", kind === "stations" ? "Postos Ticketlog" : "Abastecimentos Ticketlog", `${Number(totals.imported || 0)} importados; ${Number(totals.duplicated || 0)} duplicados; ${Number(totals.updated || 0)} horários atualizados; ${Number(totals.rejected || 0)} rejeitados`, 0),
      ]);
      return Response.json({ ok: true });
    }

    if (body.action !== "import" || !Array.isArray(body.records) || !body.records.length || body.records.length > 500) return Response.json({ error: "Envie de 1 a 500 registros por lote." }, { status: 400 });
    const now = new Date().toISOString();
    let imported = 0, duplicated = 0, updated = 0, rejected = 0, geocoded = 0, pendingGeocode = 0;
    const errors: Array<{ row: number; error: string }> = [];
    const statements: D1PreparedStatement[] = [];
    const timeOperations = new Set<number>();

    for (let index = 0; index < body.records.length; index++) {
      const record = body.records[index];
      if (kind === "stations") {
        const code = upper(record.sourceCode || record.stationCode, 80), name = clean(record.name || record.stationName, 180), city = clean(record.city, 120), uf = upper(record.uf, 2);
        if (!code || !name || !city || uf.length !== 2) { rejected++; errors.push({ row: index + 1, error: "Código, posto, município ou UF inválido." }); continue; }
        const lat = coordinate(record.latitude, 90), lng = coordinate(record.longitude, 180), hasCoordinates = lat !== 0 && lng !== 0;
        statements.push(env.DB.prepare(`INSERT INTO ticketlog_stations (id, workspace_id, source_code, name, cnpj, address, neighborhood, city, uf, cep, latitude, longitude, geocode_status, active, created_at, created_by, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id, source_code) DO UPDATE SET name=excluded.name, cnpj=excluded.cnpj, address=excluded.address, neighborhood=excluded.neighborhood, city=excluded.city, uf=excluded.uf, cep=excluded.cep, latitude=excluded.latitude, longitude=excluded.longitude, geocode_status=excluded.geocode_status, active=excluded.active, updated_at=excluded.updated_at, updated_by=excluded.updated_by`).bind(crypto.randomUUID(), WORKSPACE_ID, code, name, clean(record.cnpj, 30) || null, clean(record.address, 240) || null, clean(record.neighborhood, 120) || null, city, uf, clean(record.cep, 20) || null, hasCoordinates ? lat : null, hasCoordinates ? lng : null, hasCoordinates ? "Informado" : "Pendente", String(record.active ?? "Sim").toLocaleLowerCase("pt-BR") !== "não" ? 1 : 0, now, access.user.email, now, access.user.email));
        if (hasCoordinates) geocoded++; else pendingGeocode++;
      } else {
        const rawTime = clean(record.occurredTime, 20);
        if(rawTime && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(rawTime)){ rejected++; errors.push({row:index+1,error:"Hora inválida. Use HH:MM:SS."}); continue; }
        const time = rawTime ? (rawTime.length===5 ? rawTime+":00" : rawTime) : null;
        const transaction = clean(record.transactionCode, 80), date = isoDate(record.occurredOn), plate = upper(record.plate, 20), stationCode = upper(record.stationCode, 80), stationName = clean(record.stationName, 180), liters = number(record.liters), service = clean(record.service, 80) || "Abastecimento";
        if (!transaction || !date || !plate || !stationCode || !stationName || liters <= 0 || service.toLocaleLowerCase("pt-BR") !== "abastecimento") { rejected++; errors.push({ row: index + 1, error: service.toLocaleLowerCase("pt-BR") !== "abastecimento" ? "Serviço diferente de abastecimento." : "Transação, data, placa, posto ou litros inválido." }); continue; }
        statements.push(env.DB.prepare(`INSERT OR IGNORE INTO ticketlog_fuelings (id, workspace_id, transaction_code, client_code, client_name, occurred_on, occurred_time, plate, directorate, responsible, fleet_type, vehicle_model, service, product, driver_code, driver_name, original_price, liters, final_price, final_value, odometer, station_code, station_name, city, uf, vehicle_link_status, vehicle_id, import_batch_id, imported_at, imported_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), WORKSPACE_ID, transaction, clean(record.clientCode, 80) || null, clean(record.clientName, 180) || null, date, time, plate, clean(record.directorate, 120) || null, clean(record.responsible, 120) || null, clean(record.fleetType, 100) || null, clean(record.vehicleModel, 140) || null, service, clean(record.product, 120) || null, clean(record.driverCode, 80) || null, clean(record.driverName, 180) || null, number(record.originalPrice), liters, number(record.finalPrice), number(record.finalValue), number(record.odometer), stationCode, stationName, clean(record.city, 120) || null, upper(record.uf, 2) || null, clean(record.vehicleLinkStatus, 40) || "Pendente de vínculo", clean(record.vehicleId, 80) || null, batchId, now, access.user.email));
        timeOperations.add(statements.length);
        statements.push(env.DB.prepare(`UPDATE ticketlog_fuelings SET occurred_time=? WHERE workspace_id=? AND transaction_code=? AND occurred_on=? AND UPPER(REPLACE(plate,'-',''))=? AND station_code=? AND ABS(liters-?)<0.000001 AND COALESCE(product,'')=? AND ? IS NOT NULL AND COALESCE(occurred_time,'')!=?`).bind(time,WORKSPACE_ID,transaction,date,plate.replace(/-/g,''),stationCode,liters,clean(record.product,120),time,time));
      }
    }

    for (let start = 0; start < statements.length; start += 50) {
      const results = await env.DB.batch(statements.slice(start, start + 50));
      for (const [offset,result] of results.entries()) {
        if(timeOperations.has(start+offset)){if(result.meta.changes){updated++;duplicated--;}continue;}
        if (result.meta.changes) imported++;
        else if (kind === "fuelings") duplicated++;
        else rejected++;
      }
    }
    return Response.json({ ok: true, imported, duplicated, updated, rejected, geocoded, pendingGeocode, errors: errors.slice(0, 20) });
  } catch (error) {
    console.error("Ticketlog import failed", error);
    return Response.json({ error: "Não foi possível concluir esta parte da importação." }, { status: 503 });
  }
}
