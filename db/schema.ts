import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appState = sqliteTable("app_state", {
  workspaceId: text("workspace_id").primaryKey(),
  data: text("data").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

export const securityAudit = sqliteTable(
  "security_audit",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    createdAt: text("created_at").notNull(),
    userEmail: text("user_email").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    detail: text("detail").notNull(),
    stateVersion: integer("state_version").notNull(),
  },
  (table) => [
    index("idx_security_audit_workspace_created").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const deletedRecords = sqliteTable(
  "deleted_records",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    collection: text("collection").notNull(),
    recordId: text("record_id").notNull(),
    data: text("data").notNull(),
    deletedAt: text("deleted_at").notNull(),
    deletedBy: text("deleted_by").notNull(),
    restoredAt: text("restored_at"),
    restoredBy: text("restored_by"),
  },
  (table) => [
    index("idx_deleted_records_workspace_deleted").on(
      table.workspaceId,
      table.deletedAt,
    ),
  ],
);

export const stateBackups = sqliteTable(
  "state_backups",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    stateVersion: integer("state_version").notNull(),
    objectKey: text("object_key").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
  },
  (table) => [
    index("idx_state_backups_workspace_created").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const accessLogs = sqliteTable(
  "access_logs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userEmail: text("user_email").notNull(),
    displayName: text("display_name"),
    event: text("event").notNull(),
    route: text("route").notNull(),
    createdAt: text("created_at").notNull(),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("idx_access_logs_workspace_created").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("idx_access_logs_workspace_user").on(
      table.workspaceId,
      table.userEmail,
    ),
  ],
);

export const ticketlogStations = sqliteTable(
  "ticketlog_stations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sourceCode: text("source_code").notNull(),
    name: text("name").notNull(),
    cnpj: text("cnpj"),
    address: text("address"),
    neighborhood: text("neighborhood"),
    city: text("city").notNull(),
    uf: text("uf").notNull(),
    cep: text("cep"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    geocodeStatus: text("geocode_status").notNull().default("Pendente"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").notNull(),
  },
  (table) => [
    uniqueIndex("uq_ticketlog_stations_workspace_code").on(
      table.workspaceId,
      table.sourceCode,
    ),
    index("idx_ticketlog_stations_workspace_city").on(
      table.workspaceId,
      table.city,
      table.uf,
    ),
  ],
);

export const ticketlogFuelings = sqliteTable(
  "ticketlog_fuelings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    transactionCode: text("transaction_code").notNull(),
    clientCode: text("client_code"),
    clientName: text("client_name"),
    occurredOn: text("occurred_on").notNull(),
    occurredTime: text("occurred_time"),
    plate: text("plate").notNull(),
    directorate: text("directorate"),
    responsible: text("responsible"),
    fleetType: text("fleet_type"),
    vehicleModel: text("vehicle_model"),
    service: text("service").notNull(),
    product: text("product"),
    driverCode: text("driver_code"),
    driverName: text("driver_name"),
    originalPrice: real("original_price"),
    liters: real("liters").notNull(),
    finalPrice: real("final_price"),
    finalValue: real("final_value"),
    odometer: real("odometer"),
    stationCode: text("station_code").notNull(),
    stationName: text("station_name").notNull(),
    city: text("city"),
    uf: text("uf"),
    vehicleLinkStatus: text("vehicle_link_status").notNull(),
    vehicleId: text("vehicle_id"),
    importBatchId: text("import_batch_id").notNull(),
    importedAt: text("imported_at").notNull(),
    importedBy: text("imported_by").notNull(),
  },
  (table) => [
    uniqueIndex("uq_ticketlog_fuelings_workspace_transaction").on(
      table.workspaceId,
      table.transactionCode,
    ),
    index("idx_ticketlog_fuelings_workspace_date").on(
      table.workspaceId,
      table.occurredOn,
    ),
    index("idx_ticketlog_fuelings_workspace_plate").on(
      table.workspaceId,
      table.plate,
    ),
    index("idx_ticketlog_fuelings_workspace_station").on(
      table.workspaceId,
      table.stationCode,
    ),
    index("idx_ticketlog_fuelings_workspace_link").on(
      table.workspaceId,
      table.vehicleLinkStatus,
    ),
  ],
);

export const ticketlogImportBatches = sqliteTable(
  "ticketlog_import_batches",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    imported: integer("imported").notNull(),
    duplicated: integer("duplicated").notNull(),
    updated: integer("updated").notNull().default(0),
    rejected: integer("rejected").notNull(),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(),
  },
  (table) => [
    index("idx_ticketlog_batches_workspace_created").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const geoRouteCache = sqliteTable(
  "geo_route_cache",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    originCode: text("origin_code").notNull(),
    alternativeId: text("alternative_id").notNull(),
    distanceKm: real("distance_km"),
    durationMinutes: real("duration_minutes"),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    calculatedAt: text("calculated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_geo_route_workspace_pair").on(
      table.workspaceId,
      table.originCode,
      table.alternativeId,
    ),
    index("idx_geo_route_workspace_origin").on(
      table.workspaceId,
      table.originCode,
    ),
    index("idx_geo_route_workspace_status").on(table.workspaceId, table.status),
  ],
);

export const volumeParameters = sqliteTable('volume_parameters', {id:text('id').primaryKey(),workspaceId:text('workspace_id').notNull(),version:integer('version').notNull(),data:text('data').notNull(),changes:text('changes').notNull(),createdAt:text('created_at').notNull(),createdBy:text('created_by').notNull()},t=>[uniqueIndex('volume_parameters_version').on(t.workspaceId,t.version)]);
export const volumeReviews = sqliteTable('volume_reviews',{id:text('id').primaryKey(),workspaceId:text('workspace_id').notNull(),recordKey:text('record_key').notNull(),status:text('status').notNull(),observation:text('observation').notNull(),updatedAt:text('updated_at').notNull(),updatedBy:text('updated_by').notNull()},t=>[uniqueIndex('volume_reviews_record').on(t.workspaceId,t.recordKey)]);

// File deletion ledger; operational invoice/measurement data is never compacted.
export const documentRemovals = sqliteTable('document_removals', {
  key: text('object_key').primaryKey(), workspaceId: text('workspace_id').notNull(),
  status: text('status').notNull(), token: text('token').notNull(),
  expiresAt: text('expires_at').notNull(), createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(), bytes: integer('bytes').notNull(),
  etag: text('etag').notNull(), detail: text('detail').notNull(),
});
