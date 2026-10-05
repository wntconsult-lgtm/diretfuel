import { env } from "cloudflare:workers";
import { decodeStoredState, encodeStoredState } from "@/lib/directfuel-state-codec";
import { cleanupPreviousTicketlogImports } from "@/lib/directfuel-ticketlog-cleanup";
import { requireVixparUser, WORKSPACE_ID } from "@/lib/directfuel-access";
import { hasAction, hasPermission, isAdmin, validateState } from "@/lib/directfuel-security";

export const dynamic = "force-dynamic";

type AnyRow = Record<string, unknown>;
type State = {
  frota?: AnyRow[];
  unidades?: AnyRow[];
  produtos?: AnyRow[];
  postos?: AnyRow[];
  acordos?: AnyRow[];
  abastecimentos?: AnyRow[];
  geoStations?: AnyRow[];
  geoParams?: AnyRow;
  stationReviews?: AnyRow[];
};

const clean = (value: unknown, max = 240) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const numeric = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const isOpportunityWithinRadius = (row: AnyRow) =>
  row.opportunity === true &&
  row.within_radius === true &&
  numeric(row.road_radius_km) > 0 &&
  numeric(row.road_distance_km) <= numeric(row.road_radius_km);
const plate = (value: unknown) =>
  clean(value, 30)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
const taxId = (value: unknown) => clean(value, 30).replace(/\D/g, "");
const normalized = (value: unknown) =>
  clean(value, 180)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const isoDate = (value: unknown) =>
  /^\d{4}-\d{2}-\d{2}$/.test(clean(value, 10)) ? clean(value, 10) : "";
const validCoordinates = (lat: unknown, lng: unknown) =>
  numeric(lat) >= -90 &&
  numeric(lat) <= 90 &&
  numeric(lng) >= -180 &&
  numeric(lng) <= 180 &&
  numeric(lat) !== 0 &&
  numeric(lng) !== 0;
const sameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};
const list = (value: unknown) =>
  Array.isArray(value) ? (value as AnyRow[]) : [];
const active = (item: AnyRow) =>
  item.active !== false &&
  item.active !== 0 &&
  item.active !== "0" &&
  !["Inativo", "Cancelado"].includes(clean(item.status));

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (degree: number) => (degree * Math.PI) / 180,
    dLat = rad(lat2 - lat1),
    dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const STATION_NAME_STOP_WORDS = new Set([
  "auto",
  "combustiveis",
  "de",
  "do",
  "da",
  "e",
  "ltda",
  "posto",
  "rede",
]);

function stationNameSimilarity(left: unknown, right: unknown) {
  const tokens = (value: unknown) =>
      normalized(value)
        .split(" ")
        .filter((token) => token && !STATION_NAME_STOP_WORDS.has(token)),
    leftTokens = new Set(tokens(left)),
    rightTokens = new Set(tokens(right));
  if (!leftTokens.size || !rightTokens.size)
    return normalized(left) === normalized(right) ? 1 : 0;
  const intersection = [...leftTokens].filter((token) =>
      rightTokens.has(token),
    ).length,
    union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function sameStationRegion(left: AnyRow, right: AnyRow) {
  const leftCity = normalized(left.city || left.municipio),
    rightCity = normalized(right.city || right.municipio),
    leftUf = clean(left.uf, 2).toUpperCase(),
    rightUf = clean(right.uf, 2).toUpperCase();
  return (
    !!leftCity &&
    !!rightCity &&
    !!leftUf &&
    !!rightUf &&
    leftCity === rightCity &&
    leftUf === rightUf
  );
}

function automaticStationMatch(origin: AnyRow, alternative: AnyRow) {
  const airDistanceKm = haversine(
    numeric(origin.latitude),
    numeric(origin.longitude),
    numeric(alternative.lat),
    numeric(alternative.lng),
  );
  const sameRegion = sameStationRegion(origin, alternative),
    nameSimilarity = stationNameSimilarity(
      origin.station_name || origin.name,
      alternative.name || alternative.station_name,
    );
  if (taxId(origin.cnpj) && taxId(origin.cnpj) === taxId(alternative.cnpj))
    return {
      type: "automatic_cnpj",
      label: "Mesmo posto automático · CNPJ idêntico",
      airDistanceKm,
    };
  if (airDistanceKm <= 0.03 && sameRegion && nameSimilarity >= 0.5)
    return {
      type: "automatic_coordinates",
      label: "Mesmo local automático · nome, coordenadas, município e UF compatíveis",
      airDistanceKm,
    };
  if (airDistanceKm <= 0.15 && sameRegion && nameSimilarity >= 0.5)
    return {
      type: "automatic_name_coordinates",
      label: "Mesmo local automático · nome, município e proximidade",
      airDistanceKm,
    };
  return null;
}

function reviewedStationMatch(origin: AnyRow, alternative: AnyRow, state: State) {
  const review = list(state.stationReviews).find(item => item.stationCode === (origin.station_code || origin.source_code));
  if (!review) return automaticStationMatch(origin, alternative);
  return review.mode === "same" && review.targetId === stationIdentity(alternative)
    ? { type: "manual", label: "Mesmo posto confirmado manualmente", airDistanceKm: 0 }
    : null;
}

function stationIdentity(alternative: AnyRow) {
  return clean(
    alternative.operationalId || alternative.code || alternative.id,
  );
}

function resolvedOperationalStationId(
  item: AnyRow,
  state: State,
  maps: ReturnType<typeof operationalMaps>,
) {
  const explicitId = clean(item.operationalStationId || item.postoId);
  if (explicitId && maps.stations.has(explicitId)) {
    const explicitStation = maps.stations.get(explicitId) as AnyRow;
    const itemHasRegion = !!normalized(item.city || item.municipio) &&
      !!clean(item.uf, 2);
    if (!itemHasRegion || sameStationRegion(item, explicitStation))
      return explicitId;
  }

  const stations = list(state.postos).filter((station) => active(station));
  const code = normalized(item.code || item.codigo);
  if (code) {
    const byCode = stations.filter((station) =>
      [station.id, station.codigo].some((value) => normalized(value) === code),
    );
    if (byCode.length === 1) return clean(byCode[0].id);
  }

  const regional = stations.filter((station) => sameStationRegion(item, station));
  const latitude = numeric(item.lat ?? item.latitude),
    longitude = numeric(item.lng ?? item.longitude);
  if (validCoordinates(latitude, longitude)) {
    const nearby = regional
      .filter((station) => validCoordinates(station.latitude, station.longitude))
      .map((station) => ({
        station,
        distance: haversine(
          latitude,
          longitude,
          numeric(station.latitude),
          numeric(station.longitude),
        ),
      }))
      .filter(
        ({ station, distance }) =>
          distance <= 0.15 &&
          (distance <= 0.03 ||
            stationNameSimilarity(
              item.name,
              station.fantasia || station.razao,
            ) >= 0.5),
      )
      .sort((left, right) => left.distance - right.distance);
    if (
      nearby.length === 1 ||
      (nearby.length > 1 && nearby[0].distance + 0.01 < nearby[1].distance)
    )
      return clean(nearby[0].station.id);
  }

  const byName = regional.filter(
    (station) =>
      normalized(item.name) === normalized(station.fantasia || station.razao),
  );
  return byName.length === 1 ? clean(byName[0].id) : "";
}

async function loadState(): Promise<State> {
  const row = await env.DB.prepare(
    "SELECT data FROM app_state WHERE workspace_id = ?",
  )
    .bind(WORKSPACE_ID)
    .first<{ data: string }>();
  return row?.data ? await decodeStoredState<State>(row.data) : {};
}

function filters(url: URL) {
  const clauses = ["f.workspace_id = ?"],
    values: unknown[] = [WORKSPACE_ID];
  const from = isoDate(url.searchParams.get("from")),
    to = isoDate(url.searchParams.get("to"));
  const uf = clean(url.searchParams.get("uf"), 2).toUpperCase(),
    products = [...new Set(url.searchParams.getAll("product").map(value=>clean(value,120)).filter(Boolean))];
  const station = clean(url.searchParams.get("station"), 80),
    status = clean(url.searchParams.get("status"), 40),
    origin = clean(url.searchParams.get("origin"), 20),
    opportunity = clean(url.searchParams.get("opportunity"), 20),
    minLiters = Math.max(0, numeric(url.searchParams.get("minLiters"))),
    maxLiters = Math.max(0, numeric(url.searchParams.get("maxLiters")));
  if (origin === "DirectFuel") clauses.push("1 = 0");
  if (from) {
    clauses.push("f.occurred_on >= ?");
    values.push(from);
  }
  if (to) {
    clauses.push("f.occurred_on <= ?");
    values.push(to);
  }
  if (uf) {
    clauses.push("f.uf = ?");
    values.push(uf);
  }
  if (products.length) {
    clauses.push(`f.product IN (${products.map(()=>"?").join(",")})`);
    values.push(...products);
  }
  if (station) {
    clauses.push("f.station_code = ?");
    values.push(station);
  }
  return {
    where: clauses.join(" AND "),
    values,
    from,
    to,
    uf,
    products,
    station,
    status,
    origin,
    opportunity,
    minLiters,
    maxLiters,
  };
}

function filterByStationVolume(
  rows: AnyRow[],
  minLiters: number,
  maxLiters: number,
) {
  if (!minLiters && !maxLiters) return rows;
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = `${clean(row.source)}|${clean(row.station_code)}`;
    totals.set(key, (totals.get(key) || 0) + numeric(row.liters));
  }
  return rows.filter((row) => {
    const total = totals.get(`${clean(row.source)}|${clean(row.station_code)}`) || 0;
    return (!minLiters || total >= minLiters) && (!maxLiters || total <= maxLiters);
  });
}

function operationalMaps(state: State) {
  const fleet = new Map(
    list(state.frota).map((item) => [plate(item.placa), item]),
  );
  const units = new Map(
    list(state.unidades).map((item) => [clean(item.id), item]),
  );
  const products = list(state.produtos),
    productAliases = new Map<string, string>();
  for (const product of products)
    for (const value of [
      product.id,
      product.descricao,
      product.curta,
      product.familia,
      product.sap,
    ]) {
      const key = normalized(value);
      if (key) productAliases.set(key, clean(product.id));
    }
  const stations = new Map(
    list(state.postos).map((item) => [clean(item.id), item]),
  );
  return { fleet, units, products, productAliases, stations };
}

function resolveProductId(
  raw: unknown,
  vehicle: AnyRow | undefined,
  maps: ReturnType<typeof operationalMaps>,
) {
  const key = normalized(raw);
  if (maps.productAliases.has(key)) return maps.productAliases.get(key) || "";
  const words = key.split(" ").filter(Boolean);
  for (const product of maps.products) {
    const candidate = normalized(
      `${product.curta || ""} ${product.descricao || ""}`,
    );
    if (words.length && words.every((word) => candidate.includes(word)))
      return clean(product.id);
    if (
      /\bs\s*10\b/.test(key) &&
      /\bs\s*10\b/.test(candidate) &&
      key.includes("aditiv") === candidate.includes("aditiv")
    )
      return clean(product.id);
  }
  return clean(vehicle?.produtoId);
}

function productDescriptor(value: unknown) {
  const text = normalized(value),
    dieselS10 = text.includes("diesel") && /\bs\s*10\b/.test(text);
  return {
    family: dieselS10 ? "diesel_s10" : text,
    variant: text.includes("aditiv")
      ? "aditivado"
      : text.includes("comum")
        ? "comum"
        : "não informado",
  };
}

function matchAlternativeProduct(
  ticketlogProduct: unknown,
  resolvedProductId: string,
  alternativeProductIds: string[],
  maps: ReturnType<typeof operationalMaps>,
) {
  const ticket = productDescriptor(ticketlogProduct),
    candidates = (alternativeProductIds.length
      ? alternativeProductIds
      : [resolvedProductId]
    ).filter(Boolean),
    matches = candidates
      .map((productId) => {
        const product = maps.products.find(
            (item) => clean(item.id) === productId,
          ),
          name = clean(product?.curta || product?.descricao || productId),
          directFuel = productDescriptor(
            `${product?.curta || ""} ${product?.descricao || ""}`,
          );
        if (
          ticket.family === "diesel_s10" &&
          directFuel.family === "diesel_s10"
        ) {
          if (
            ticket.variant === directFuel.variant ||
            ticket.variant === "não informado" ||
            directFuel.variant === "não informado"
          )
            return {
              productId,
              productName: name,
              rank: 0,
              matchType: "exact",
              matchLabel: "Produto idêntico",
            };
          if (
            ticket.variant === "comum" &&
            directFuel.variant === "aditivado"
          )
            return {
              productId,
              productName: name,
              rank: 1,
              matchType: "compatible_upgrade",
              matchLabel: "Compatível · Upgrade para S-10 aditivado",
            };
          if (
            ticket.variant === "aditivado" &&
            directFuel.variant === "comum"
          )
            return {
              productId,
              productName: name,
              rank: 2,
              matchType: "compatible_review",
              matchLabel: "Compatível com ressalva · Validar substituição",
            };
        }
        if (productId === resolvedProductId)
          return {
            productId,
            productName: name,
            rank: 0,
            matchType: "exact",
            matchLabel: "Produto idêntico",
          };
        return null;
      })
      .filter(Boolean) as Array<{
      productId: string;
      productName: string;
      rank: number;
      matchType: string;
      matchLabel: string;
    }>;
  return matches.sort((a, b) => a.rank - b.rank)[0];
}

function alternatives(state: State, maps: ReturnType<typeof operationalMaps>) {
  const configured = list(state.geoStations).filter(
      (item) => !item.demo && active(item),
    ),
    configuredOperationalIds = new Set(
      configured
        .filter((item) => (clean(item.source) || "DirectFuel") === "DirectFuel")
        .map((item) => resolvedOperationalStationId(item, state, maps))
        .filter(Boolean),
    ),
    operational = list(state.postos)
      .filter((item) => active(item) && !configuredOperationalIds.has(clean(item.id)))
      .map((item) => ({
        id: `directfuel-${clean(item.id)}`,
        source: "DirectFuel",
        operationalStationId: clean(item.id),
        code: clean(item.codigo || item.id),
        name: clean(item.fantasia || item.razao),
        address: clean(item.endereco),
        neighborhood: clean(item.bairro),
        city: clean(item.municipio),
        uf: clean(item.uf, 2),
        latitude: item.latitude,
        longitude: item.longitude,
        productIds: [],
        status: "Ativo",
      }));
  return configured.concat(operational)
    .filter((item) => !item.demo && active(item))
    .map((item) => {
      const source = clean(item.source) || "DirectFuel",
        operationalId =
          source === "DirectFuel"
            ? resolvedOperationalStationId(item, state, maps)
            : clean(item.operationalStationId || item.postoId);
      const station = operationalId
        ? maps.stations.get(operationalId)
        : undefined;
      const productIds = new Set(
        list(item.productIds)
          .map((entry) => clean(entry))
          .filter(Boolean),
      );
      if (source === "DirectFuel" && operationalId)
        for (const agreement of list(state.acordos))
          if (clean(agreement.postoId) === operationalId)
            productIds.add(clean(agreement.produtoId));
      return {
        id: clean(item.id),
        source,
        operationalId,
        code: clean(station?.codigo || item.code || item.id),
        name: clean(station?.fantasia || station?.razao || item.name),
        cnpj: clean(station?.cnpj || item.cnpj),
        address: clean(
          [
            station?.endereco || item.address,
            station?.bairro || item.neighborhood,
          ]
            .filter(Boolean)
            .join(", "),
        ),
        city: clean(station?.municipio || item.city),
        uf: clean(station?.uf || item.uf, 2).toUpperCase(),
        lat: numeric(station?.latitude ?? item.lat ?? item.latitude),
        lng: numeric(station?.longitude ?? item.lng ?? item.longitude),
        productIds: [...productIds],
        prices:
          item.prices && typeof item.prices === "object"
            ? (item.prices as AnyRow)
            : {},
        price: numeric(item.price),
      };
    })
    .filter((item) => item.id && item.name);
}

function agreementAt(
  state: State,
  stationId: string,
  productId: string,
  date: string,
  rawProduct: unknown,
  maps: ReturnType<typeof operationalMaps>,
) {
  const valid = list(state.acordos)
    .filter(
      (item) =>
        clean(item.postoId) === stationId &&
        ["Vigente", "Encerrado", "Vencido", "Expirado"].includes(clean(item.status) || "Vigente") &&
        (!isoDate(item.inicio) || date >= isoDate(item.inicio)) &&
        (!isoDate(item.fim) || date <= isoDate(item.fim)),
    )
    .sort((a, b) => isoDate(b.inicio).localeCompare(isoDate(a.inicio)));
  const exact = valid.find((item) => clean(item.produtoId) === productId);
  if (exact)
    return {
      agreement: exact,
      productMatch: matchAlternativeProduct(
        rawProduct,
        resolveProductId(rawProduct, undefined, maps),
        [clean(exact.produtoId)],
        maps,
      ),
    };
  for (const agreement of valid) {
    const productMatch = matchAlternativeProduct(
      rawProduct,
      resolveProductId(rawProduct, undefined, maps),
      [clean(agreement.produtoId)],
      maps,
    );
    if (productMatch) return { agreement, productMatch };
  }
  return { agreement: undefined, productMatch: undefined };
}

function directFuelRows(state: State, selected: ReturnType<typeof filters>) {
  if (
    selected.origin === "Ticketlog" ||
    selected.status ||
    selected.opportunity === "yes"
  )
    return [];
  const maps = operationalMaps(state),
    selectedProductIds = selected.products.map(product=>resolveProductId(product, undefined, maps)).filter(Boolean);
  return list(state.abastecimentos)
    .map((item) => {
      const station = maps.stations.get(clean(item.postoId)),
        vehicle = maps.fleet.get(plate(item.placa)),
        unit = maps.units.get(clean(item.unidadeId || vehicle?.unidadeId)),
        productId = clean(item.produtoId || vehicle?.produtoId),
        product = maps.products.find((entry) => clean(entry.id) === productId),
        latitude = numeric(station?.latitude),
        longitude = numeric(station?.longitude),
        hasCoordinates = validCoordinates(latitude, longitude);
      return {
        source: "DirectFuel",
        transaction_code: clean(item.id),
        occurred_on: isoDate(item.data),
        plate: plate(item.placa),
        driver_name: clean(item.motorista),
        vehicle_model: clean(item.veiculo || vehicle?.modelo),
        product: clean(product?.curta || product?.descricao || productId),
        product_id: productId,
        liters: numeric(item.qt),
        final_price: numeric(item.preco),
        final_value: numeric(item.total),
        station_code: clean(station?.codigo || station?.id || item.postoId),
        station_name: clean(station?.fantasia || station?.razao),
        city: clean(station?.municipio),
        uf: clean(station?.uf, 2).toUpperCase(),
        unit_id: clean(unit?.id),
        unit_name: clean(unit?.nome),
        cost_center: clean(item.centroCusto || vehicle?.centroCusto),
        latitude,
        longitude,
        geocode_status: clean(station?.geocodeStatus),
        analysis_status: hasCoordinates
          ? "directfuel_actual"
          : "directfuel_station_no_coordinates",
        analysis_label: hasCoordinates
          ? "Abastecimento DirectFuel"
          : "Posto DirectFuel sem coordenadas",
      };
    })
    .filter((item) => {
      if (!item.occurred_on || !item.station_code) return false;
      if (selected.from && item.occurred_on < selected.from) return false;
      if (selected.to && item.occurred_on > selected.to) return false;
      if (selected.uf && item.uf !== selected.uf) return false;
      if (selected.products.length && !selectedProductIds.includes(item.product_id) && !selected.products.includes(item.product))
        return false;
      if (selected.station && item.station_code !== selected.station)
        return false;
      return true;
    });
}

function groupRows(
  rows: AnyRow[],
  key: (row: AnyRow) => string,
  label: (row: AnyRow) => string,
) {
  const grouped = new Map<string, AnyRow>();
  for (const row of rows) {
    const id = key(row) || "Não informado",
      current = grouped.get(id) || {
        id,
        label: label(row) || "Não informado",
        records: 0,
        liters: 0,
        value: 0,
        grossSaving: 0,
        ready: 0,
        opportunities: 0,
      };
    current.records = numeric(current.records) + 1;
    current.liters = numeric(current.liters) + numeric(row.liters);
    current.value = numeric(current.value) + numeric(row.final_value);
    current.grossSaving =
      numeric(current.grossSaving) +
      (isOpportunityWithinRadius(row) ? numeric(row.gross_saving) : 0);
    if (row.analysis_status === "ready")
      current.ready = numeric(current.ready) + 1;
    if (isOpportunityWithinRadius(row))
      current.opportunities = numeric(current.opportunities) + 1;
    grouped.set(id, current);
  }
  return [...grouped.values()].sort(
    (a, b) => numeric(b.liters) - numeric(a.liters),
  );
}

type RouteCandidate = {
  alt: ReturnType<typeof alternatives>[number];
  productMatch: NonNullable<ReturnType<typeof matchAlternativeProduct>>;
  distance: number;
  withinRadius: boolean;
  stationMatchType: string | undefined;
  stationMatchLabel: string | undefined;
  route?: AnyRow;
  sameLocation: boolean;
  directPrice: number;
  ticketPrice: number;
  gross: number;
  hasValidAgreement: boolean;
  agreementNumber: string;
  airDistanceKm: number;
};
function analyzeRows(rawRows: AnyRow[], state: State, routeRows: AnyRow[]): AnyRow[] {
  const maps = operationalMaps(state),
    available = alternatives(state, maps),
    routes = new Map(
      routeRows.map((item) => [
        `${item.origin_code}|${item.alternative_id}`,
        item,
      ]),
    );
  const storedParams = (state.geoParams || {}) as AnyRow,
    roadRadiusKm =
      numeric(storedParams.maxRoadDistanceKm ?? storedParams.maxDetourKm) ||
      30,
    params = {
    maxRoadDistanceKm: roadRadiusKm,
    minPriceDiff: 0,
    ...storedParams,
  } as AnyRow;
  return rawRows.map((row) => {
    const vehicle = maps.fleet.get(plate(row.plate)),
      unit = vehicle ? maps.units.get(clean(vehicle.unidadeId)) : undefined;
    const productId = resolveProductId(row.product, vehicle, maps),
      date = clean(row.occurred_on, 10);
    const base = {
      ...row,
      vehicle_id: vehicle ? clean(vehicle.id) : clean(row.vehicle_id),
      unit_id: clean(vehicle?.unidadeId),
      unit_name: clean(unit?.nome),
      cost_center: clean(vehicle?.centroCusto || unit?.centroCusto),
      product_id: productId,
    };
    if (clean(row.vehicle_link_status) !== "Vinculado" || !vehicle)
      return {
        ...base,
        analysis_status: "pending_plate",
        analysis_label: "Pendente de placa",
        plate_pending_reason: !plate(row.plate)
          ? "Placa ausente ou inválida na carga Ticketlog"
          : vehicle
            ? "Placa cadastrada na Frota; vínculo ainda não reprocessado"
            : "Placa não encontrada no cadastro de Frota",
        plate_pending_action: vehicle
          ? "Atualizar vínculos pendentes"
          : "Cadastrar ou corrigir a placa na Frota",
      };
    if (!validCoordinates(row.latitude, row.longitude))
      return {
        ...base,
        analysis_status: "station_no_coordinates",
        analysis_label: "Posto sem coordenadas",
      };
    const review = list(state.stationReviews).find(item => item.stationCode === row.station_code);
    const compatible = available
      .filter(
        (alt) =>
          alt.source === "DirectFuel" && validCoordinates(alt.lat, alt.lng),
      )
      .map((alt) => ({
        alt,
        productMatch: matchAlternativeProduct(
          row.product,
          productId,
          alt.productIds,
          maps,
        ),
        stationMatch: reviewedStationMatch(row, alt, state),
      }))
      .filter((item) => !!item.productMatch);
    if (review?.mode === "same" && !compatible.some(item => stationIdentity(item.alt) === review.targetId)) return { ...base, analysis_status: "station_match_review", analysis_label: "O posto confirmado não está disponível para este produto. Revise a decisão ou o cadastro." };
    if (!compatible.length)
      return {
        ...base,
        analysis_status: "no_nearby_station",
        analysis_label: "Sem posto DirectFuel próximo",
      };
    const automaticGroups = new Map<string, typeof compatible>();
    for (const item of compatible) {
      if (!item.stationMatch) continue;
      const key = stationIdentity(item.alt),
        group = automaticGroups.get(key) || [];
      group.push(item);
      automaticGroups.set(key, group);
    }
    const cnpjGroups = new Map(
      [...automaticGroups].filter(([, items]) =>
        items.some((item) => item.stationMatch?.type === "automatic_cnpj"),
      ),
    );
    const resolvedGroups = cnpjGroups.size ? cnpjGroups : automaticGroups;
    if (resolvedGroups.size > 1)
      return {
        ...base,
        analysis_status: "station_match_review",
        analysis_label: "Revisar vínculo automático de posto",
        station_match_type: "ambiguous",
        station_match_label: "Mais de um posto DirectFuel compatível até 150 m",
        station_match_candidates: [...resolvedGroups.values()]
          .map((items) => clean(items[0]?.alt?.name))
          .filter(Boolean),
      };
    const automaticKey = [...resolvedGroups.keys()][0] || "";
    let hadPendingRoute = false,
      hadRouteError = false,
      hadCalculatedRoute = false,
      hadMissingAgreement = false,
      hadCoordinateConflict = false,
      nearestWithoutAgreement: Pick<RouteCandidate, "alt" | "productMatch" | "distance" | "withinRadius" | "stationMatchType" | "stationMatchLabel"> | undefined;
    const candidates: RouteCandidate[] = [];
    for (const { alt, productMatch, stationMatch } of compatible) {
      if (!productMatch) continue;
      const route = routes.get(`${clean(row.station_code)}|${alt.id}`);
      const sameLocation =
        !!stationMatch && stationIdentity(alt) === automaticKey;
      const airDistanceKm = haversine(
        numeric(row.latitude),
        numeric(row.longitude),
        alt.lat,
        alt.lng,
      );
      if (!sameLocation && airDistanceKm > roadRadiusKm) continue;
      if (airDistanceKm <= 0.03 && !stationMatch && !review) {
        hadCoordinateConflict = true;
        continue;
      }
      if (!sameLocation && route && clean(route.status) === "Erro") {
        hadRouteError = true;
        continue;
      }
      if (!sameLocation && !route) {
        hadPendingRoute = true;
        continue;
      }
      const distance = sameLocation ? 0 : numeric(route?.distance_km);
      hadCalculatedRoute = true;
      const agreementResult = alt.operationalId
          ? agreementAt(
              state,
              alt.operationalId,
              productMatch.productId,
              date,
              row.product,
              maps,
            )
          : { agreement: undefined, productMatch: undefined },
        agreement = agreementResult.agreement,
        effectiveProductMatch = agreementResult.productMatch || productMatch;
      const directPrice = agreement ? numeric(agreement.preco) : 0;
      if (!agreement || !directPrice) {
        hadMissingAgreement = true;
        if (
          !nearestWithoutAgreement ||
          distance < numeric(nearestWithoutAgreement.distance)
        )
          nearestWithoutAgreement = {
            alt,
            productMatch: effectiveProductMatch,
            distance,
            withinRadius: distance <= roadRadiusKm,
            stationMatchType: sameLocation ? stationMatch?.type : "road_radius",
            stationMatchLabel: sameLocation
              ? stationMatch?.label
              : "Alternativa encontrada pelo raio rodoviário",
          };
        continue;
      }
      const ticketPrice = numeric(row.final_price),
        liters = numeric(row.liters),
        gross = (ticketPrice - directPrice) * liters,
        hasValidAgreement = true;
      candidates.push({
        alt,
        route,
        productMatch: effectiveProductMatch,
        sameLocation,
        distance,
        withinRadius: distance <= roadRadiusKm,
        directPrice,
        ticketPrice,
        gross,
        hasValidAgreement,
        agreementNumber: clean(agreement.numero || agreement.id),
        stationMatchType: sameLocation ? stationMatch?.type : "road_radius",
        stationMatchLabel: sameLocation
          ? stationMatch?.label
          : "Alternativa encontrada pelo raio rodoviário",
        airDistanceKm: sameLocation
          ? numeric(stationMatch?.airDistanceKm)
          : airDistanceKm,
      });
    }
    if (!candidates.length && hadCoordinateConflict)
      return {
        ...base,
        analysis_status: "station_match_review",
        analysis_label:
          "Revisar coordenadas: locais diferentes ocupam o mesmo ponto",
      };
    if (!candidates.length && hadMissingAgreement)
      return {
        ...base,
        analysis_status: "no_valid_agreement",
        analysis_label: "Sem acordo DirectFuel válido na data",
        alternative_id: nearestWithoutAgreement?.alt?.id || "",
        alternative_code: nearestWithoutAgreement?.alt?.code || "",
        alternative_name: nearestWithoutAgreement?.alt?.name || "",
        alternative_city: nearestWithoutAgreement?.alt?.city || "",
        alternative_uf: nearestWithoutAgreement?.alt?.uf || "",
        road_distance_km: nearestWithoutAgreement?.distance ?? null,
        road_radius_km: roadRadiusKm,
        within_radius: nearestWithoutAgreement?.withinRadius ?? false,
        directfuel_product_id:
          nearestWithoutAgreement?.productMatch?.productId || "",
        directfuel_product:
          nearestWithoutAgreement?.productMatch?.productName || "",
        product_match_type:
          nearestWithoutAgreement?.productMatch?.matchType || "",
        product_match_label:
          nearestWithoutAgreement?.productMatch?.matchLabel || "",
        station_match_type:
          nearestWithoutAgreement?.stationMatchType || "",
        station_match_label:
          nearestWithoutAgreement?.stationMatchLabel || "",
      };
    if (!candidates.length && hadPendingRoute)
      return {
        ...base,
        analysis_status: "route_pending",
        analysis_label: "Rota rodoviária pendente",
      };
    if (!candidates.length && hadRouteError)
      return {
        ...base,
        analysis_status: "route_error",
        analysis_label: "Erro ao calcular rota rodoviária",
      };
    if (!candidates.length && hadCalculatedRoute)
      return {
        ...base,
        analysis_status: "no_nearby_station",
        analysis_label: "Sem alternativa econômica calculável",
      };
    if (!candidates.length)
      return {
        ...base,
        analysis_status: "no_nearby_station",
        analysis_label: "Sem posto DirectFuel próximo",
      };
    const insideRadius = candidates.filter((item) => item.withinRadius);
    if (!insideRadius.length && candidates.length) {
      candidates.sort((a, b) => a.distance - b.distance);
      const nearest = candidates[0];
      return {
        ...base,
        analysis_status: "outside_radius",
        analysis_label: "Alternativa encontrada fora do raio",
        alternative_id: nearest.alt.id,
        alternative_code: nearest.alt.code,
        alternative_name: nearest.alt.name,
        alternative_address: nearest.alt.address,
        alternative_city: nearest.alt.city,
        alternative_uf: nearest.alt.uf,
        directfuel_price: nearest.directPrice,
        ticketlog_price: nearest.ticketPrice,
        price_difference: nearest.ticketPrice - nearest.directPrice,
        road_distance_km: nearest.distance,
        road_radius_km: roadRadiusKm,
        within_radius: false,
        duration_minutes: nearest.sameLocation
          ? 0
          : numeric(nearest.route?.duration_minutes),
        gross_saving: 0,
        opportunity: false,
        opportunity_level: "Fora do raio configurado",
        directfuel_product_id: nearest.productMatch.productId,
        directfuel_product: nearest.productMatch.productName,
        product_match_type: nearest.productMatch.matchType,
        product_match_label: nearest.productMatch.matchLabel,
        station_match_type: nearest.stationMatchType,
        station_match_label: nearest.stationMatchLabel,
        air_distance_km: nearest.airDistanceKm,
        has_valid_agreement: nearest.hasValidAgreement,
        agreement_number: nearest.agreementNumber,
      };
    }
    insideRadius.sort(
      (a, b) => b.gross - a.gross || a.distance - b.distance,
    );
    const best = insideRadius[0];
    const opportunity =
        best.gross > 0 &&
        best.ticketPrice - best.directPrice >= numeric(params.minPriceDiff),
      opportunityLevel = opportunity
        ? "Oportunidade dentro do raio"
        : "Sem ganho mínimo";
    return {
      ...base,
      analysis_status: "ready",
      analysis_label: "Análise concluída no raio",
      alternative_id: best.alt.id,
      alternative_code: best.alt.code,
      alternative_name: best.alt.name,
      alternative_address: best.alt.address,
      alternative_city: best.alt.city,
      alternative_uf: best.alt.uf,
      directfuel_price: best.directPrice,
      ticketlog_price: best.ticketPrice,
      price_difference: best.ticketPrice - best.directPrice,
      road_distance_km: best.distance,
      road_radius_km: roadRadiusKm,
      within_radius: true,
      duration_minutes: best.sameLocation
        ? 0
        : numeric(best.route?.duration_minutes),
      gross_saving: best.gross,
      opportunity,
      opportunity_level: opportunityLevel,
      directfuel_product_id: best.productMatch.productId,
      directfuel_product: best.productMatch.productName,
      product_match_type: best.productMatch.matchType,
      product_match_label: best.productMatch.matchLabel,
      station_match_type: best.stationMatchType,
      station_match_label: best.stationMatchLabel,
      air_distance_km: best.airDistanceKm,
      has_valid_agreement: best.hasValidAgreement,
      agreement_number: best.agreementNumber,
    };
  });
}

export async function GET(request: Request) {
  const access = await requireVixparUser();
  if ("error" in access)
    return Response.json({ error: access.error }, { status: access.status });
  if (!hasPermission(access, "analysis_geo"))
    return Response.json(
      { error: "Acesso à análise geográfica não autorizado." },
      { status: 403 },
    );
  try {
    await cleanupPreviousTicketlogImports(env.DB, env.BUCKET, access);
    const selected = filters(new URL(request.url)),
      state = await loadState();
    const [fuelings, routeResult, products, ufs, stationOptions] =
      await Promise.all([
        env.DB.prepare(
          `SELECT f.transaction_code, f.occurred_on, f.plate, f.driver_name, f.vehicle_model, f.product, f.liters, f.final_price, f.final_value, f.station_code, f.station_name, f.city, f.uf, f.vehicle_link_status, f.vehicle_id, f.odometer, s.cnpj, s.address, s.latitude, s.longitude, s.geocode_status FROM ticketlog_fuelings f LEFT JOIN ticketlog_stations s ON s.workspace_id = f.workspace_id AND s.source_code = f.station_code WHERE ${selected.where} ORDER BY f.occurred_on DESC, f.transaction_code DESC LIMIT 20000`,
        )
          .bind(...selected.values)
          .all(),
        env.DB.prepare(
          "SELECT origin_code, alternative_id, distance_km, duration_minutes, provider, status, error, calculated_at FROM geo_route_cache WHERE workspace_id = ?",
        )
          .bind(WORKSPACE_ID)
          .all(),
        env.DB.prepare(
          "SELECT DISTINCT product FROM ticketlog_fuelings WHERE workspace_id = ? AND product IS NOT NULL AND product != '' ORDER BY product",
        )
          .bind(WORKSPACE_ID)
          .all(),
        env.DB.prepare(
          "SELECT DISTINCT uf FROM ticketlog_fuelings WHERE workspace_id = ? AND uf IS NOT NULL AND uf != '' ORDER BY uf",
        )
          .bind(WORKSPACE_ID)
          .all(),
        env.DB.prepare(
          "SELECT station_code, MAX(station_name) AS station_name, MAX(city) AS city, MAX(uf) AS uf FROM ticketlog_fuelings WHERE workspace_id = ? GROUP BY station_code ORDER BY station_name",
        )
          .bind(WORKSPACE_ID)
          .all(),
      ]);
    let rows = analyzeRows(
      fuelings.results as AnyRow[],
      state,
      routeResult.results as AnyRow[],
    );
    rows = filterByStationVolume(rows, selected.minLiters, selected.maxLiters);
    if (selected.status)
      rows = rows.filter(
        (row) => clean(row.analysis_status) === selected.status,
      );
    if (selected.opportunity === "yes")
      rows = rows.filter(isOpportunityWithinRadius);
    const directRows = filterByStationVolume(
        directFuelRows(state, selected),
        selected.minLiters,
        selected.maxLiters,
      ),
      directFuelSummary = {
        records: directRows.length,
        liters: directRows.reduce(
          (sum, row) => sum + numeric(row.liters),
          0,
        ),
        value: directRows.reduce(
          (sum, row) => sum + numeric(row.final_value),
          0,
        ),
        stations: new Set(
          directRows.map((row) => clean(row.station_code)),
        ).size,
        plates: new Set(directRows.map((row) => plate(row.plate))).size,
        geocoded_records: directRows.filter(
          (row) => row.analysis_status === "directfuel_actual",
        ).length,
        pending_coordinates: directRows.filter(
          (row) => row.analysis_status === "directfuel_station_no_coordinates",
        ).length,
      };
    const count = (status: string) =>
      rows.filter((row) => row.analysis_status === status).length;
    const summary = {
      records: rows.length,
      liters: rows.reduce((sum, row) => sum + numeric(row.liters), 0),
      value: rows.reduce((sum, row) => sum + numeric(row.final_value), 0),
      plates: new Set(rows.map((row) => plate(row.plate))).size,
      stations: new Set(rows.map((row) => clean(row.station_code))).size,
      pending_plate: count("pending_plate"),
      station_no_coordinates: count("station_no_coordinates"),
      station_no_coordinates_stations: new Set(rows.filter((row) => row.analysis_status === "station_no_coordinates").map((row) => clean(row.station_code))).size,
      no_nearby_station: count("no_nearby_station"),
      route_pending: count("route_pending"),
      route_pending_stations: new Set(rows.filter((row) => row.analysis_status === "route_pending").map((row) => clean(row.station_code))).size,
      route_error: count("route_error"),
      route_error_stations: new Set(rows.filter((row) => row.analysis_status === "route_error").map((row) => clean(row.station_code))).size,
      outside_radius: count("outside_radius"),
      no_valid_agreement: count("no_valid_agreement"),
      station_match_review: count("station_match_review"),
      station_match_review_stations: new Set(rows.filter((row) => row.analysis_status === "station_match_review").map((row) => clean(row.station_code))).size,
      automatic_station_matches: rows.filter((row) =>
        clean(row.station_match_type).startsWith("automatic_"),
      ).length,
      ready: count("ready"),
      with_nearby_station: rows.filter((row) =>
        ["route_pending", "outside_radius", "no_valid_agreement", "ready"].includes(
          clean(row.analysis_status),
        ),
      ).length,
      with_valid_agreement: rows.filter(
        (row) => row.has_valid_agreement === true,
      ).length,
      gross_saving: rows.reduce(
        (sum, row) =>
          sum + (isOpportunityWithinRadius(row) ? numeric(row.gross_saving) : 0),
        0,
      ),
      opportunities: rows.filter(isOpportunityWithinRadius).length,
      opportunity_liters: rows
        .filter(isOpportunityWithinRadius)
        .reduce((sum, row) => sum + numeric(row.liters), 0),
      first_date: rows.reduce(
        (min, row) =>
          !min || clean(row.occurred_on) < min ? clean(row.occurred_on) : min,
        "",
      ),
      last_date: rows.reduce(
        (max, row) =>
          clean(row.occurred_on) > max ? clean(row.occurred_on) : max,
        "",
      ),
    };
    const groups = {
      stations: groupRows(
        rows,
        (row) => clean(row.station_code),
        (row) =>
          `${clean(row.station_name)} · ${clean(row.city)}/${clean(row.uf)}`,
      ),
      plates: groupRows(
        rows,
        (row) => plate(row.plate),
        (row) => plate(row.plate),
      ),
      units: groupRows(
        rows,
        (row) => clean(row.unit_id),
        (row) => clean(row.unit_name),
      ),
      costCenters: groupRows(
        rows,
        (row) => clean(row.cost_center),
        (row) => clean(row.cost_center),
      ),
      periods: groupRows(
        rows,
        (row) => clean(row.occurred_on).slice(0, 7),
        (row) => clean(row.occurred_on).slice(0, 7),
      ),
    };
    return Response.json(
      {
        canManage:
          hasAction(access, "analysis_geo", "editar"),
        summary,
        rows,
        directFuelRows: directRows,
        directFuelSummary,
        stationReviews: list(state.stationReviews),
        groups,
        alternatives: alternatives(state, operationalMaps(state)),
        routes: routeResult.results,
        options: {
          products: [
            ...new Set([
              ...products.results.map((item) => clean(item.product)),
              ...list(state.produtos).map((item) =>
                clean(item.curta || item.descricao),
              ),
            ].filter(Boolean)),
          ].sort(),
          ufs: [
            ...new Set([
              ...ufs.results.map((item) => clean(item.uf, 2).toUpperCase()),
              ...list(state.postos).map((item) =>
                clean(item.uf, 2).toUpperCase(),
              ),
            ].filter(Boolean)),
          ].sort(),
          stations: [
            ...(stationOptions.results as AnyRow[]).map((item) => ({
              ...item,
              source: "Ticketlog",
            })),
            ...list(state.postos)
              .filter((item) => active(item))
              .map((item) => ({
                station_code: clean(item.codigo || item.id),
                station_name: clean(item.fantasia || item.razao),
                city: clean(item.municipio),
                uf: clean(item.uf, 2).toUpperCase(),
                source: "DirectFuel",
              })),
          ],
        },
        filters: selected,
        params: state.geoParams || {},
        detailLimited: fuelings.results.length >= 20000,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Geographic analysis read failed", error);
    return Response.json(
      { error: "Não foi possível calcular a análise geográfica." },
      { status: 503 },
    );
  }
}

async function roadTable(
  origin: { lat: number; lng: number },
  destinations: Array<{ lat: number; lng: number }>,
) {
  const coordinates = [origin, ...destinations]
    .map((point) => `${point.lng},${point.lat}`)
    .join(";");
  const destinationIndexes = destinations
    .map((_, index) => index + 1)
    .join(";");
  const url = `https://router.project-osrm.org/table/v1/driving/${coordinates}?sources=0&destinations=${destinationIndexes}&annotations=distance,duration`;
  const response = await fetch(url, {
    headers: { "user-agent": "DirectFuel-Vixpar/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
  const payload = (await response.json()) as {
    code?: string;
    distances?: Array<Array<number | null>>;
    durations?: Array<Array<number | null>>;
  };
  if (payload.code !== "Ok") throw new Error("Rotas não encontradas");
  return destinations.map((_, index) => {
    const distance = payload.distances?.[0]?.[index],
      duration = payload.durations?.[0]?.[index],
      found = typeof distance === "number" && Number.isFinite(distance);
    return {
      found,
      distanceKm: found ? distance / 1000 : null,
      durationMinutes:
        typeof duration === "number" && Number.isFinite(duration)
          ? duration / 60
          : null,
    };
  });
}

const normalizeRoad = (value: unknown) =>
  clean(value, 160)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\bRODOVIA\b/g, "ROD")
    .replace(/\s+/g, " ")
    .trim();

function roadLabelsFromValues(values: unknown[]) {
  const raw = values.map((value) => clean(value, 160)).filter(Boolean),
    labels = new Set<string>();
  for (const value of raw) {
    const normalizedValue = normalizeRoad(value);
    const referencePattern =
      /\b(BR|SP|ES|MG|RJ|BA|PR|SC|RS|GO|MT|MS|PA|MA|PE|TO|RO|AC|AM|RR|AP|CE|PI|RN|PB|AL|SE|DF)[ -]?(\d{2,3})\b/g;
    for (const match of normalizedValue.matchAll(referencePattern))
      labels.add(`${match[1]}-${match[2]}`);
    if (
      normalizedValue.length >= 7 &&
      /\b(ROD|AUTOESTRADA|ESTRADA)\b/.test(normalizedValue)
    )
      labels.add(normalizedValue);
  }
  return [...labels];
}

function roadLabels(step: AnyRow) {
  return roadLabelsFromValues([step.ref, step.name]);
}

async function roadDetails(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
) {
  const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`,
    url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=false&steps=true&alternatives=false`;
  const response = await fetch(url, {
    headers: { "user-agent": "DirectFuel-Vixpar/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
  const payload = (await response.json()) as {
    code?: string;
    routes?: Array<{
      distance?: number;
      duration?: number;
      legs?: Array<{ steps?: AnyRow[] }>;
    }>;
  };
  const route = payload.routes?.[0];
  if (payload.code !== "Ok" || !route)
    throw new Error("Rota detalhada não encontrada");
  const steps = (route.legs?.[0]?.steps || []).filter(
      (step) => numeric(step.distance) >= 20,
    ),
    startRoads = new Set(steps.slice(0, 5).flatMap(roadLabels)),
    endRoads = new Set(steps.slice(-5).flatMap(roadLabels)),
    commonRoads = [...startRoads].filter((road) => endRoads.has(road)),
    routeRoads = [
      ...new Set(
        steps
          .flatMap(roadLabels)
          .filter((road) => road && !/^ROD$/.test(road)),
      ),
    ],
    highwayPattern = /^(BR|SP|ES|MG|RJ|BA|PR|SC|RS|GO|MT|MS|PA|MA|PE|TO|RO|AC|AM|RR|AP|CE|PI|RN|PB|AL|SE|DF)-\d{2,3}$/,
    corridorWithConnection =
      !commonRoads.length &&
      routeRoads.some((road) => highwayPattern.test(road)) &&
      ([...startRoads].some((road) => highwayPattern.test(road)) ||
        [...endRoads].some((road) => highwayPattern.test(road)));
  return {
    distanceKm: numeric(route.distance) / 1000,
    durationMinutes: numeric(route.duration) / 60,
    originRoads: [...startRoads].slice(0, 8),
    destinationRoads: [...endRoads].slice(0, 8),
    commonRoads: commonRoads.slice(0, 8),
    routeRoads: routeRoads.slice(0, 20),
    sameRoad: commonRoads.length > 0,
    corridorWithConnection,
  };
}

async function geocodeAddress(address: string) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=br&q=${encodeURIComponent(address)}`,
    {
      headers: {
        "user-agent":
          "DirectFuel-Vixpar/1.0 (https://directfuel-vixpar.espa-o-de-tr-3403.chatgpt.site)",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error(`Geocodificação HTTP ${response.status}`);
  const results = (await response.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
    type?: string;
  }>;
  return results
    .map((item) => ({
      latitude: numeric(item.lat),
      longitude: numeric(item.lon),
      label: clean(item.display_name, 500),
      type: clean(item.type, 80),
    }))
    .filter((item) => validCoordinates(item.latitude, item.longitude));
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function POST(request: Request) {
  const access = await requireVixparUser();
  if ("error" in access)
    return Response.json({ error: access.error }, { status: access.status });
  if (!hasPermission(access, "analysis_geo"))
    return Response.json(
      { error: "Acesso à análise geográfica não autorizado." },
      { status: 403 },
    );
  if (!sameOrigin(request))
    return Response.json(
      { error: "Origem da solicitação não autorizada." },
      { status: 403 },
    );
  try {
    const body = (await request.json()) as {
      mode?: string;
      targetId?: string;
      reason?: string;
      action?: string;
      refresh?: boolean;
      retryErrors?: boolean;
      address?: string;
      stationCode?: string;
      from?: string;
      to?: string;
      product?: string | string[];
    };
    if (body.action === "review-station") {
      if (!hasAction(access, "analysis_geo", "editar")) return Response.json({ error: "Sem permissão para revisar vínculos." }, { status: 403 });
      const code = clean(body.stationCode, 80), mode = clean(body.mode), targetId = clean(body.targetId, 120), reason = clean(body.reason, 1000);
      if (!["same", "different", "automatic"].includes(mode) || !code || !reason) return Response.json({ error: "Informe a decisão e a justificativa." }, { status: 400 });
      const station = await env.DB.prepare("SELECT source_code FROM ticketlog_stations WHERE workspace_id = ? AND source_code = ?").bind(WORKSPACE_ID, code).first();
      if (!station) return Response.json({ error: "Posto Ticketlog não encontrado." }, { status: 404 });
      const current = await env.DB.prepare("SELECT data, version FROM app_state WHERE workspace_id = ?").bind(WORKSPACE_ID).first<{ data: string; version: number }>();
      if (!current) return Response.json({ error: "Base indisponível." }, { status: 409 });
      const state = await decodeStoredState<State>(current.data);
      if (mode === "same" && !list(state.postos).some(item => item.id === targetId)) return Response.json({ error: "Selecione um posto DirectFuel válido." }, { status: 400 });
      const now = new Date().toISOString();
      state.stationReviews = list(state.stationReviews).filter(item => item.stationCode !== code);
      if (mode !== "automatic") state.stationReviews.push({ stationCode: code, mode, targetId: mode === "same" ? targetId : "", reason, reviewedAt: now, reviewedBy: access.user.email });
      const validation = validateState(state);
      if (validation) return Response.json({ error: validation }, { status: 400 });
      const result = await env.DB.prepare("UPDATE app_state SET data = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE workspace_id = ? AND version = ? AND NOT EXISTS (SELECT 1 FROM document_removals WHERE workspace_id = app_state.workspace_id AND status = 'pending' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(await encodeStoredState(JSON.stringify(state)), now, access.user.email, WORKSPACE_ID, current.version).run();
      if (!result.meta.changes) return Response.json({ error: "A base mudou. Atualize e tente novamente." }, { status: 409 });
      return Response.json({ ok: true });
    }
    if (body.action === "same-road-analysis") {
      const stationCode = clean(body.stationCode, 80),
        station = await env.DB.prepare(
          "SELECT source_code, name, cnpj, address, neighborhood, city, uf, latitude, longitude FROM ticketlog_stations WHERE workspace_id = ? AND source_code = ?",
        )
          .bind(WORKSPACE_ID, stationCode)
          .first<AnyRow>();
      if (!station)
        return Response.json(
          { error: "Posto Ticketlog não encontrado." },
          { status: 404 },
        );
      if (!validCoordinates(station.latitude, station.longitude))
        return Response.json(
          { error: "Georreferencie o posto Ticketlog antes de analisar a rodovia." },
          { status: 422 },
        );
      const state = await loadState(),
        maps = operationalMaps(state),
        from = isoDate(body.from),
        to = isoDate(body.to),
        requestedProducts = [...new Set((Array.isArray(body.product)?body.product:[body.product]).map(value=>clean(value,120)).filter(Boolean))],
        fuelingClauses = [
          "workspace_id = ?",
          "station_code = ?",
          "product IS NOT NULL",
          "product != ''",
        ],
        fuelingValues: unknown[] = [WORKSPACE_ID, stationCode];
      if (from) {
        fuelingClauses.push("occurred_on >= ?");
        fuelingValues.push(from);
      }
      if (to) {
        fuelingClauses.push("occurred_on <= ?");
        fuelingValues.push(to);
      }
      if (requestedProducts.length) {
        fuelingClauses.push(`product IN (${requestedProducts.map(()=>"?").join(",")})`);
        fuelingValues.push(...requestedProducts);
      }
      const productResult = await env.DB.prepare(
          `SELECT product, SUM(liters) AS liters, SUM(final_value) AS value, SUM(final_value) / NULLIF(SUM(liters), 0) AS average_price, MAX(occurred_on) AS reference_date, COUNT(*) AS records FROM ticketlog_fuelings WHERE ${fuelingClauses.join(" AND ")} GROUP BY product ORDER BY product`,
        )
          .bind(...fuelingValues)
          .all<AnyRow>(),
        productStats = productResult.results.map((item) => ({
          product: clean(item.product),
          productId: resolveProductId(item.product, undefined, maps),
          liters: numeric(item.liters),
          value: numeric(item.value),
          averagePrice: numeric(item.average_price),
          referenceDate: isoDate(item.reference_date),
          records: numeric(item.records),
        })),
        products = productStats.map((item) => item.product).filter(Boolean),
        origin = {
          lat: numeric(station.latitude),
          lng: numeric(station.longitude),
        },
        storedParams = (state.geoParams || {}) as AnyRow,
        roadRadiusKm =
          numeric(storedParams.maxRoadDistanceKm ?? storedParams.maxDetourKm) ||
          30,
        maxCandidates = Math.max(
          1,
          Math.min(12, numeric(storedParams.maxCandidates) || 6),
        ),
        nearby = alternatives(state, maps)
          .filter(
            (item) =>
              item.source === "DirectFuel" &&
              validCoordinates(item.lat, item.lng) &&
              productStats.some((stat) =>
                matchAlternativeProduct(
                  stat.product,
                  stat.productId,
                  item.productIds,
                  maps,
                ),
              ),
          )
          .map((item) => ({
            item,
            airDistanceKm: haversine(origin.lat, origin.lng, item.lat, item.lng),
          }))
          .filter((candidate) => candidate.airDistanceKm <= roadRadiusKm)
          .sort((a, b) => a.airDistanceKm - b.airDistanceKm)
          .slice(0, maxCandidates),
        routeResults = await Promise.all(
          nearby.map(async ({ item, airDistanceKm }) => {
            const review = list(state.stationReviews).find(entry => entry.stationCode === stationCode);
            const stationMatch = reviewedStationMatch(
              {
                station_code: stationCode,
                cnpj: station.cnpj,
                latitude: station.latitude,
                longitude: station.longitude,
                station_name: station.name,
                city: station.city,
                uf: station.uf,
              },
              item, state,
            );
            if (airDistanceKm <= 0.03 && !stationMatch && !review)
              return {
                alternative_id: item.id,
                alternative_code: item.code,
                alternative_name: item.name,
                city: item.city,
                uf: item.uf,
                operational_id: item.operationalId,
                product_ids: item.productIds,
                air_distance_km: airDistanceKm,
                road_distance_km: null,
                duration_minutes: null,
                origin_roads: roadLabelsFromValues([
                  station.address,
                  station.neighborhood,
                ]),
                destination_roads: roadLabelsFromValues([item.address]),
                common_roads: [],
                route_roads: [],
                same_road: false,
                corridor_with_connection: false,
                within_radius: false,
                product_comparisons: [],
                gross_saving: 0,
                coordinate_conflict: true,
                error:
                  "Coordenadas coincidentes, mas nome, município ou UF são diferentes",
                classification: "Revisar coordenadas do posto DirectFuel",
              };
            try {
              const detail =
                  airDistanceKm <= 0.005 && stationMatch
                    ? {
                        distanceKm: 0,
                        durationMinutes: 0,
                        originRoads: [] as string[],
                        destinationRoads: [] as string[],
                        commonRoads: ["Ponto coincidente"],
                        routeRoads: [] as string[],
                        sameRoad: true,
                        corridorWithConnection: false,
                      }
                    : await roadDetails(origin, {
                        lat: item.lat,
                        lng: item.lng,
                      }),
                originRoads = [
                  ...new Set([
                    ...roadLabelsFromValues([
                      station.address,
                      station.neighborhood,
                    ]),
                    ...detail.originRoads,
                  ]),
                ],
                destinationRoads = [
                  ...new Set([
                    ...roadLabelsFromValues([item.address]),
                    ...detail.destinationRoads,
                  ]),
                ],
                commonRoads = [
                  ...new Set([
                    ...detail.commonRoads,
                    ...originRoads.filter((road) =>
                      destinationRoads.includes(road),
                    ),
                  ]),
                ],
                sameRoad = detail.sameRoad || commonRoads.length > 0,
                withinRadius = detail.distanceKm <= roadRadiusKm,
                comparisons = productStats
                  .map((stat) => {
                    const initialProductMatch = matchAlternativeProduct(
                      stat.product,
                      stat.productId,
                      item.productIds,
                      maps,
                    );
                    if (!initialProductMatch) return null;
                    const agreementResult = item.operationalId
                        ? agreementAt(
                            state,
                            item.operationalId,
                            initialProductMatch.productId,
                            stat.referenceDate,
                            stat.product,
                            maps,
                          )
                        : { agreement: undefined, productMatch: undefined },
                      agreement = agreementResult.agreement,
                      productMatch =
                        agreementResult.productMatch || initialProductMatch,
                      directPrice = agreement ? numeric(agreement.preco) : 0,
                      grossSaving = directPrice
                        ? (stat.averagePrice - directPrice) * stat.liters
                        : 0;
                    return {
                      product: stat.product,
                      product_id: stat.productId,
                      directfuel_product_id: productMatch.productId,
                      directfuel_product: productMatch.productName,
                      product_match_type: productMatch.matchType,
                      product_match_label: productMatch.matchLabel,
                      liters: stat.liters,
                      records: stat.records,
                      reference_date: stat.referenceDate,
                      ticketlog_price: stat.averagePrice,
                      directfuel_price: directPrice,
                      agreement_number: clean(agreement?.numero || agreement?.id),
                      agreement_status: agreement
                        ? clean(agreement.status) || "Vigente"
                        : directPrice
                          ? "Preço cadastrado"
                          : "Sem acordo válido",
                      gross_saving: grossSaving,
                    };
                  })
                  .filter(Boolean) as AnyRow[],
                calculatedGrossSaving = comparisons.reduce(
                  (sum, comparison) =>
                    sum + numeric(comparison.gross_saving),
                  0,
                ),
                grossSaving = withinRadius ? calculatedGrossSaving : 0,
                roadIdentified =
                  originRoads.length > 0 || destinationRoads.length > 0;
              return {
                alternative_id: item.id,
                alternative_code: item.code,
                alternative_name: item.name,
                city: item.city,
                uf: item.uf,
                operational_id: item.operationalId,
                product_ids: item.productIds,
                air_distance_km: airDistanceKm,
                road_distance_km: detail.distanceKm,
                duration_minutes: detail.durationMinutes,
                origin_roads: originRoads,
                destination_roads: destinationRoads,
                common_roads: commonRoads,
                route_roads: detail.routeRoads,
                same_road: sameRoad,
                corridor_with_connection: detail.corridorWithConnection,
                within_radius: withinRadius,
                product_comparisons: comparisons,
                gross_saving: grossSaving,
                opportunity: withinRadius && grossSaving > 0,
                classification: sameRoad
                  ? "Mesma rodovia"
                  : detail.corridorWithConnection
                    ? "Mesmo corredor, com conexão"
                    : roadIdentified
                      ? "Próximo, mas fora da rodovia"
                      : "Rodovia não identificada",
              };
            } catch (error) {
              return {
                alternative_id: item.id,
                alternative_code: item.code,
                alternative_name: item.name,
                city: item.city,
                uf: item.uf,
                operational_id: item.operationalId,
                product_ids: item.productIds,
                air_distance_km: airDistanceKm,
                road_distance_km: 0,
                duration_minutes: 0,
                origin_roads: [],
                destination_roads: [],
                common_roads: [],
                route_roads: [],
                same_road: false,
                corridor_with_connection: false,
                within_radius: false,
                product_comparisons: [],
                gross_saving: 0,
                classification: "Rodovia não identificada",
                error: clean(
                  error instanceof Error ? error.message : error,
                  240,
                ),
              };
            }
          }),
        );
      routeResults.sort(
        (a, b) =>
          Number(b.same_road) - Number(a.same_road) ||
          Number(b.within_radius) - Number(a.within_radius) ||
          numeric(a.road_distance_km) - numeric(b.road_distance_km),
      );
      const identifiedRoads = [
        ...new Set(
          routeResults
            .flatMap((item) => item.origin_roads as string[])
            .filter(Boolean),
        ),
      ];
      return Response.json({
        ok: true,
        origin: {
          station_code: stationCode,
          station_name: clean(station.name),
          address: clean(station.address),
          neighborhood: clean(station.neighborhood),
          city: clean(station.city),
          uf: clean(station.uf, 2).toUpperCase(),
          latitude: origin.lat,
          longitude: origin.lng,
          roads: identifiedRoads.slice(0, 8),
        },
        products,
        roadRadiusKm,
        results: routeResults,
      });
    }
    if (!hasAction(access, "analysis_geo", "editar"))
      return Response.json(
        { error: "Somente administradores podem reprocessar a análise." },
        { status: 403 },
      );
    if (body.action === "reprocess-links") {
      const state = await loadState(),
        fleet = new Map(
          list(state.frota)
            .map((item): [string, string] => [plate(item.placa), clean(item.id)])
            .filter(([key]) => !!key),
        );
      const statements = [
        env.DB.prepare(
          "UPDATE ticketlog_fuelings SET vehicle_link_status = 'Pendente de vínculo', vehicle_id = NULL WHERE workspace_id = ?",
        ).bind(WORKSPACE_ID),
      ];
      for (const [normalizedPlate, vehicleId] of fleet)
        statements.push(
          env.DB.prepare(
            `UPDATE ticketlog_fuelings SET vehicle_link_status = 'Vinculado', vehicle_id = ?
             WHERE workspace_id = ?
             AND UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(plate, '-', ''), ' ', ''), '.', ''), '/', ''), '_', '')) = ?`,
          ).bind(vehicleId || null, WORKSPACE_ID, normalizedPlate),
        );
      for (let start = 0; start < statements.length; start += 50)
        await env.DB.batch(statements.slice(start, start + 50));
      const counts = await env.DB.prepare(
        "SELECT COUNT(*) AS records, SUM(CASE WHEN vehicle_link_status = 'Vinculado' THEN 1 ELSE 0 END) AS linked, SUM(CASE WHEN vehicle_link_status != 'Vinculado' THEN 1 ELSE 0 END) AS pending FROM ticketlog_fuelings WHERE workspace_id = ?",
      )
        .bind(WORKSPACE_ID)
        .first();
      await env.DB.prepare(
        "INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          crypto.randomUUID(),
          WORKSPACE_ID,
          new Date().toISOString(),
          access.user.email,
          "Reprocessamento",
          "Vínculos Ticketlog",
          `${numeric(counts?.linked)} vinculados; ${numeric(counts?.pending)} pendentes`,
          0,
        )
        .run();
      return Response.json({ ok: true, ...counts, fleetPlates: fleet.size });
    }
    if (body.action === "geocode") {
      const address = clean(body.address, 500);
      if (address.length < 8)
        return Response.json(
          { error: "Informe o endereço completo." },
          { status: 400 },
        );
      return Response.json({ results: await geocodeAddress(address) });
    }
    if (body.action === "geocode-ticketlog-station") {
      const stationCode = clean(body.stationCode, 80),
        station = await env.DB.prepare(
          "SELECT source_code, name, address, neighborhood, city, uf, cep FROM ticketlog_stations WHERE workspace_id = ? AND source_code = ?",
        )
          .bind(WORKSPACE_ID, stationCode)
          .first<AnyRow>();
      if (!station)
        return Response.json(
          { error: "Posto Ticketlog não encontrado." },
          { status: 404 },
        );
      const address = [
        station.address,
        station.neighborhood,
        station.city,
        station.uf,
        station.cep,
        "Brasil",
      ]
        .map((value) => clean(value))
        .filter(Boolean)
        .join(", ");
      const result = (await geocodeAddress(address))[0];
      if (!result)
        return Response.json(
          {
            error:
              "Endereço não localizado. Corrija o cadastro do posto ou informe latitude e longitude na carga.",
          },
          { status: 422 },
        );
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE ticketlog_stations SET latitude = ?, longitude = ?, geocode_status = 'Georreferenciado', updated_at = ?, updated_by = ? WHERE workspace_id = ? AND source_code = ?",
        ).bind(
          result.latitude,
          result.longitude,
          now,
          access.user.email,
          WORKSPACE_ID,
          stationCode,
        ),
        env.DB.prepare(
          "INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          crypto.randomUUID(),
          WORKSPACE_ID,
          now,
          access.user.email,
          "Geocodificação",
          "Posto Ticketlog",
          `${stationCode} · ${clean(station.name)} · ${result.label}`,
          0,
        ),
      ]);
      return Response.json({ ok: true, stationCode, ...result });
    }
    if (body.action === "geocode-ticketlog-batch") {
      if (body.refresh)
        await env.DB.prepare(
          "UPDATE ticketlog_stations SET geocode_status = 'Pendente' WHERE workspace_id = ? AND (latitude IS NULL OR longitude IS NULL) AND COALESCE(geocode_status, 'Pendente') != 'Pendente'",
        ).bind(WORKSPACE_ID).run();
      const stations = await env.DB.prepare(
        `SELECT s.source_code, s.name, s.address, s.neighborhood, s.city, s.uf, s.cep,
          COUNT(f.id) AS fuelings
        FROM ticketlog_stations s
        LEFT JOIN ticketlog_fuelings f
          ON f.workspace_id = s.workspace_id AND f.station_code = s.source_code
        WHERE s.workspace_id = ?
          AND (s.latitude IS NULL OR s.longitude IS NULL)
          AND COALESCE(s.geocode_status, 'Pendente') = 'Pendente'
        GROUP BY s.source_code, s.name, s.address, s.neighborhood, s.city, s.uf, s.cep
        ORDER BY COUNT(f.id) DESC, s.name
        LIMIT 6`,
      )
        .bind(WORKSPACE_ID)
        .all<AnyRow>();
      let geocoded = 0,
        notFound = 0,
        insufficient = 0;
      const details: AnyRow[] = [];
      for (let index = 0; index < stations.results.length; index++) {
        const station = stations.results[index],
          stationCode = clean(station.source_code, 80),
          hasMinimumData =
            clean(station.name).length >= 3 &&
            clean(station.city).length >= 2 &&
            clean(station.uf).length === 2;
        if (!hasMinimumData) {
          await env.DB.prepare(
            "UPDATE ticketlog_stations SET geocode_status = 'Dados insuficientes', updated_at = ?, updated_by = ? WHERE workspace_id = ? AND source_code = ? AND (latitude IS NULL OR longitude IS NULL)",
          )
            .bind(
              new Date().toISOString(),
              access.user.email,
              WORKSPACE_ID,
              stationCode,
            )
            .run();
          insufficient++;
          details.push({ stationCode, status: "Dados insuficientes" });
          continue;
        }
        const address = [
          station.name,
          station.address,
          station.neighborhood,
          station.city,
          station.uf,
          station.cep,
          "Brasil",
        ]
          .map((value) => clean(value))
          .filter(Boolean)
          .join(", ");
        try {
          const result = (await geocodeAddress(address))[0],
            now = new Date().toISOString();
          if (!result) {
            await env.DB.prepare(
              "UPDATE ticketlog_stations SET geocode_status = 'Não localizado', updated_at = ?, updated_by = ? WHERE workspace_id = ? AND source_code = ? AND (latitude IS NULL OR longitude IS NULL)",
            )
              .bind(now, access.user.email, WORKSPACE_ID, stationCode)
              .run();
            notFound++;
            details.push({ stationCode, status: "Não localizado" });
          } else {
            await env.DB.prepare(
              "UPDATE ticketlog_stations SET latitude = ?, longitude = ?, geocode_status = 'Georreferenciado automático', updated_at = ?, updated_by = ? WHERE workspace_id = ? AND source_code = ? AND (latitude IS NULL OR longitude IS NULL)",
            )
              .bind(
                result.latitude,
                result.longitude,
                now,
                access.user.email,
                WORKSPACE_ID,
                stationCode,
              )
              .run();
            geocoded++;
            details.push({ stationCode, status: "Georreferenciado", ...result });
          }
        } catch (error) {
          details.push({
            stationCode,
            status: "Erro temporário",
            error: error instanceof Error ? error.message : "Falha na consulta",
          });
        }
        if (index < stations.results.length - 1) await wait(1100);
      }
      const counts = await env.DB.prepare(
        `SELECT
          SUM(CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN (latitude IS NULL OR longitude IS NULL) AND COALESCE(geocode_status, 'Pendente') = 'Pendente' THEN 1 ELSE 0 END) AS remaining,
          SUM(CASE WHEN geocode_status = 'Não localizado' THEN 1 ELSE 0 END) AS not_located,
          SUM(CASE WHEN geocode_status = 'Dados insuficientes' THEN 1 ELSE 0 END) AS insufficient
        FROM ticketlog_stations WHERE workspace_id = ?`,
      )
        .bind(WORKSPACE_ID)
        .first<AnyRow>();
      await env.DB.prepare(
        "INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          crypto.randomUUID(),
          WORKSPACE_ID,
          new Date().toISOString(),
          access.user.email,
          "Geocodificação em massa",
          "Postos Ticketlog",
          `${geocoded} georreferenciados; ${notFound} não localizados; ${insufficient} com dados insuficientes`,
          0,
        )
        .run();
      return Response.json({
        ok: true,
        processed: stations.results.length,
        geocoded,
        notFound,
        insufficient,
        pending: numeric(counts?.pending),
        remaining: numeric(counts?.remaining),
        notLocatedTotal: numeric(counts?.not_located),
        insufficientTotal: numeric(counts?.insufficient),
        details,
      });
    }
    if (body.action === "route-batch") {
      const state = await loadState(),
        maps = operationalMaps(state),
        available = alternatives(state, maps).filter(
          (item) =>
            item.source === "DirectFuel" &&
            validCoordinates(item.lat, item.lng),
        );
      if (!available.length)
        return Response.json(
          { error: "Cadastre e georreferencie ao menos um posto DirectFuel." },
          { status: 400 },
        );
      if (body.refresh)
        await env.DB.prepare(
          "DELETE FROM geo_route_cache WHERE workspace_id = ?",
        )
          .bind(WORKSPACE_ID)
          .run();
      else if (body.retryErrors)
        await env.DB.prepare(
          "DELETE FROM geo_route_cache WHERE workspace_id = ? AND status != 'Calculada'",
        )
          .bind(WORKSPACE_ID)
          .run();
      const stationResult = await env.DB.prepare(
        "SELECT source_code, name, cnpj, city, uf, latitude, longitude FROM ticketlog_stations WHERE workspace_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL",
      )
        .bind(WORKSPACE_ID)
        .all(),
        stationProductResult = await env.DB.prepare(
          "SELECT DISTINCT station_code, product FROM ticketlog_fuelings WHERE workspace_id = ? AND product IS NOT NULL AND product != ''",
        )
          .bind(WORKSPACE_ID)
          .all(),
        stationProducts = new Map<string, string[]>();
      for (const item of stationProductResult.results as AnyRow[]) {
        const code = clean(item.station_code),
          products = stationProducts.get(code) || [];
        products.push(clean(item.product));
        stationProducts.set(code, products);
      }
      const radius = Math.max(
          1,
          numeric(
            state.geoParams?.maxRoadDistanceKm ?? state.geoParams?.maxDetourKm,
          ) || 30,
        );
      const pairs: Array<{
        originCode: string;
        origin: { lat: number; lng: number };
        alt: ReturnType<typeof alternatives>[number];
      }> = [];
      for (const station of stationResult.results as AnyRow[]) {
        if (!validCoordinates(station.latitude, station.longitude)) continue;
        const origin = {
          lat: numeric(station.latitude),
          lng: numeric(station.longitude),
        };
        const nearby = available
          .filter((alt) =>
            (stationProducts.get(clean(station.source_code)) || []).some(
              (product) =>
                !!matchAlternativeProduct(
                  product,
                  resolveProductId(product, undefined, maps),
                  alt.productIds,
                  maps,
                ),
            ),
          )
          .map((alt) => ({
            alt,
            air: haversine(origin.lat, origin.lng, alt.lat, alt.lng),
          }))
          .filter(
            (item) =>
              !reviewedStationMatch(
                {
                  station_code: station.source_code,
                  cnpj: station.cnpj,
                  latitude: origin.lat,
                  longitude: origin.lng,
                  station_name: station.name,
                  city: station.city,
                  uf: station.uf,
                },
                item.alt, state,
              ),
          )
          .filter((item) => item.air <= radius)
          .sort((a, b) => a.air - b.air);
        for (const item of nearby)
          pairs.push({
            originCode: clean(station.source_code),
            origin,
            alt: item.alt,
          });
      }
      const cached = await env.DB.prepare(
          "SELECT origin_code, alternative_id FROM geo_route_cache WHERE workspace_id = ?",
        )
          .bind(WORKSPACE_ID)
          .all(),
        done = new Set(
          (cached.results as AnyRow[]).map(
            (item) => `${item.origin_code}|${item.alternative_id}`,
          ),
        );
      const pending = pairs.filter(
          (pair) => !done.has(`${pair.originCode}|${pair.alt.id}`),
        ),
        pendingByOrigin = new Map<string, Array<(typeof pending)[number]>>();
      for (const pair of pending) {
        const group = pendingByOrigin.get(pair.originCode) || [];
        group.push(pair);
        pendingByOrigin.set(pair.originCode, group);
      }
      const originBatch = [...pendingByOrigin.values()].slice(0, 8),
        now = new Date().toISOString();
      const routedGroups = await Promise.all(
          originBatch.map(async (group) => {
            try {
              const results = await roadTable(
                group[0].origin,
                group.map((pair) => ({ lat: pair.alt.lat, lng: pair.alt.lng })),
              );
              return group.map((pair, index) => ({
                pair,
                ...results[index],
                status: results[index].found ? "Calculada" : "Erro",
                error: results[index].found ? "" : "Rota não encontrada",
              }));
            } catch (error) {
              return group.map((pair) => ({
                pair,
                distanceKm: 0,
                durationMinutes: 0,
                status: "Erro",
                error: clean(
                  error instanceof Error ? error.message : error,
                  240,
                ),
              }));
            }
          }),
        ),
        routed = routedGroups.flat();
      if (routed.length)
        await env.DB.batch(
          routed.map((item) =>
            env.DB.prepare(
              "INSERT INTO geo_route_cache (id, workspace_id, origin_code, alternative_id, distance_km, duration_minutes, provider, status, error, calculated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, origin_code, alternative_id) DO UPDATE SET distance_km=excluded.distance_km, duration_minutes=excluded.duration_minutes, provider=excluded.provider, status=excluded.status, error=excluded.error, calculated_at=excluded.calculated_at",
            ).bind(
              crypto.randomUUID(),
              WORKSPACE_ID,
              item.pair.originCode,
              item.pair.alt.id,
              item.distanceKm ?? null,
              item.durationMinutes ?? null,
              "OSRM/OpenStreetMap",
              item.status,
              item.error || null,
              now,
            ),
          ),
        );
      const remaining = Math.max(0, pending.length - routed.length),
        calculated = routed.filter(
          (item) => item.status === "Calculada",
        ).length,
        errors = routed.length - calculated;
      if (!remaining && routed.length)
        await env.DB.prepare(
          "INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
          .bind(
            crypto.randomUUID(),
            WORKSPACE_ID,
            now,
            access.user.email,
            "Reprocessamento",
            "Rotas geográficas",
            `${pairs.length} pares processados`,
            0,
          )
          .run();
      return Response.json({
        ok: true,
        processed: routed.length,
        calculated,
        errors,
        remaining,
        totalPairs: pairs.length,
        provider: "OSRM/OpenStreetMap",
      });
    }
    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    console.error("Geographic analysis action failed", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? `Não foi possível concluir: ${error.message}`
            : "Não foi possível concluir a ação.",
      },
      { status: 503 },
    );
  }
}
