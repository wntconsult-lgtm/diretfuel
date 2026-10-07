// Generated from lib/directfuel-geo-core.ts. Run node scripts/build-supabase-core.mjs.
// Geographic business rules ported from the original route; no provider or database access.
const WORKSPACE_ID='private';
                                      
              
                   
                      
                      
                    
                     
                            
                         
                     
                            
  

const clean = (value         , max = 240) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const numeric = (value         ) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const isOpportunityWithinRadius = (row        ) =>
  row.opportunity === true &&
  row.within_radius === true &&
  numeric(row.road_radius_km) > 0 &&
  numeric(row.road_distance_km) <= numeric(row.road_radius_km);
const plate = (value         ) =>
  clean(value, 30)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
const taxId = (value         ) => clean(value, 30).replace(/\D/g, "");
const normalized = (value         ) =>
  clean(value, 180)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const isoDate = (value         ) =>
  /^\d{4}-\d{2}-\d{2}$/.test(clean(value, 10)) ? clean(value, 10) : "";
const validCoordinates = (lat         , lng         ) =>
  numeric(lat) >= -90 &&
  numeric(lat) <= 90 &&
  numeric(lng) >= -180 &&
  numeric(lng) <= 180 &&
  numeric(lat) !== 0 &&
  numeric(lng) !== 0;
const sameOrigin = (request         ) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};
const list = (value         ) =>
  Array.isArray(value) ? (value            ) : [];
const active = (item        ) =>
  item.active !== false &&
  item.active !== 0 &&
  item.active !== "0" &&
  !["Inativo", "Cancelado"].includes(clean(item.status));

function haversine(lat1        , lng1        , lat2        , lng2        ) {
  const rad = (degree        ) => (degree * Math.PI) / 180,
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

function stationNameSimilarity(left         , right         ) {
  const tokens = (value         ) =>
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

function sameStationRegion(left        , right        ) {
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

function automaticStationMatch(origin        , alternative        ) {
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

function reviewedStationMatch(origin        , alternative        , state       ) {
  const review = list(state.stationReviews).find(item => item.stationCode === (origin.station_code || origin.source_code));
  if (!review) return automaticStationMatch(origin, alternative);
  return review.mode === "same" && review.targetId === stationIdentity(alternative)
    ? { type: "manual", label: "Mesmo posto confirmado manualmente", airDistanceKm: 0 }
    : null;
}

function stationIdentity(alternative        ) {
  return clean(
    alternative.operationalId || alternative.code || alternative.id,
  );
}

function resolvedOperationalStationId(
  item        ,
  state       ,
  maps                                    ,
) {
  const explicitId = clean(item.operationalStationId || item.postoId);
  if (explicitId && maps.stations.has(explicitId)) {
    const explicitStation = maps.stations.get(explicitId)          ;
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

function filters(url     ) {
  const clauses = ["f.workspace_id = ?"],
    values            = [WORKSPACE_ID];
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
  rows          ,
  minLiters        ,
  maxLiters        ,
) {
  if (!minLiters && !maxLiters) return rows;
  const totals = new Map                ();
  for (const row of rows) {
    const key = `${clean(row.source)}|${clean(row.station_code)}`;
    totals.set(key, (totals.get(key) || 0) + numeric(row.liters));
  }
  return rows.filter((row) => {
    const total = totals.get(`${clean(row.source)}|${clean(row.station_code)}`) || 0;
    return (!minLiters || total >= minLiters) && (!maxLiters || total <= maxLiters);
  });
}

function operationalMaps(state       ) {
  const fleet = new Map(
    list(state.frota).map((item) => [plate(item.placa), item]),
  );
  const units = new Map(
    list(state.unidades).map((item) => [clean(item.id), item]),
  );
  const products = list(state.produtos),
    productAliases = new Map                ();
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
  raw         ,
  vehicle                    ,
  maps                                    ,
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

function productDescriptor(value         ) {
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
  ticketlogProduct         ,
  resolvedProductId        ,
  alternativeProductIds          ,
  maps                                    ,
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
      .filter(Boolean)           
                        
                          
                   
                        
                         
      ;
  return matches.sort((a, b) => a.rank - b.rank)[0];
}

function alternatives(state       , maps                                    ) {
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
            ? (item.prices          )
            : {},
        price: numeric(item.price),
      };
    })
    .filter((item) => item.id && item.name);
}

function agreementAt(
  state       ,
  stationId        ,
  productId        ,
  date        ,
  rawProduct         ,
  maps                                    ,
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

function directFuelRows(state       , selected                            ) {
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
  rows          ,
  key                         ,
  label                         ,
) {
  const grouped = new Map                ();
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

                       
                                               
                                                                        
                   
                        
                                       
                                        
                 
                        
                      
                      
                
                             
                          
                        
  
function analyzeRows(rawRows          , state       , routeRows          )           {
  const maps = operationalMaps(state),
    available = alternatives(state, maps),
    routes = new Map(
      routeRows.map((item) => [
        `${item.origin_code}|${item.alternative_id}`,
        item,
      ]),
    );
  const storedParams = (state.geoParams || {})          ,
    roadRadiusKm =
      numeric(storedParams.maxRoadDistanceKm ?? storedParams.maxDetourKm) ||
      30,
    params = {
    maxRoadDistanceKm: roadRadiusKm,
    minPriceDiff: 0,
    ...storedParams,
  }          ;
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
    const automaticGroups = new Map                           ();
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
      nearestWithoutAgreement                                                                                                                                   ;
    const candidates                   = [];
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


export {active,list,clean,numeric,plate,isoDate,validCoordinates,filters,operationalMaps,alternatives,analyzeRows,directFuelRows,groupRows,filterByStationVolume,isOpportunityWithinRadius};
