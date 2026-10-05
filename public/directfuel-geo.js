(() => {
  const geo = {
    tab: "overview",
    group: "stations",
    data: null,
    loading: false,
    error: "",
    selected: "",
    routing: false,
    bulkGeocoding: false,
    bulkDirectFuelGeocoding: false,
    leafletMap: null,
    opportunityLine: null,
    opportunityDirectionMarker: null,
    activeOpportunity: null,
    automaticRouteSignature: "",
    mapMode: "network",
    heatmap: false,
    filters: { from: "", to: "", uf: "", product: [], status: "", station: "", origin: "", opportunity: "", minLiters: "", maxLiters: "" },
  };
  const esc = (value) =>
    String(value == null ? "" : value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const xml = esc,
    numeric = (value) => Number(value || 0),
    count = (value) => numeric(value).toLocaleString("pt-BR"),
    pct = (part, total) =>
      total
        ? `${((numeric(part) / numeric(total)) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
        : "0,0%";
  const option = (value, label, selected) =>
    `<option value="${esc(value)}" ${String(value) === String(selected) ? "selected" : ""}>${esc(label)}</option>`;
  const statusInfo = {
    pending_plate: ["Pendente de placa", "warn"],
    station_no_coordinates: ["Posto sem coordenadas", "bad"],
    station_match_review: ["Revisar vínculo de posto", "warn"],
    no_nearby_station: ["Sem alternativa DirectFuel compatível", "warn"],
    route_pending: ["Rota rodoviária pendente", "warn"],
    route_error: ["Erro ao calcular rota rodoviária", "bad"],
    outside_radius: ["Alternativa fora do raio", "warn"],
    no_valid_agreement: ["Sem acordo DirectFuel válido", "bad"],
    ready: ["Análise concluída no raio", "ok"],
    directfuel_actual: ["Abastecimento DirectFuel", "ok"],
    directfuel_station_no_coordinates: ["Posto DirectFuel sem coordenadas", "warn"],
  };
  const statusBadge = (key) => {
    const info = statusInfo[key] || [key || "Não classificado", "warn"];
    return `<span class="badge ${info[1]}">${esc(info[0])}</span>`;
  };
  const downloadFile = (name, content, type) => {
    const blob = new Blob([content], { type }),
      link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  function ensureParams() {
    const stored = db.geoParams || {};
    db.geoParams = {
      minPriceDiff: 0.1,
      maxCandidates: 6,
      ...stored,
      maxRoadDistanceKm:
        numeric(stored.maxRoadDistanceKm ?? stored.maxDetourKm) || 30,
    };
    delete db.geoParams.confirmedKm;
    delete db.geoParams.probableKm;
    db.geoStations = (db.geoStations || []).filter((item) => !item.demo);
  }

  function queryString() {
    const params = new URLSearchParams();
    Object.entries(geo.filters).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach(item=>params.append(key,item));
      else if (value) params.set(key, value);
    });
    return params.toString();
  }
  async function loadData(message = "") {
    if (geo.loading) return;
    geo.loading = true;
    geo.error = "";
    renderPage();
    try {
      const response = await fetch(`/api/geo-analysis?${queryString()}`, {
          cache: "no-store",
        }),
        payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Falha ao carregar a análise");
      geo.data = payload;
      if (message) toast(message);
    } catch (error) {
      geo.error = error.message || "Não foi possível carregar os dados";
    } finally {
      geo.loading = false;
      if (route === "analysis_geo") {
        renderPage();
        scheduleAutomaticRoutes();
      }
    }
  }

  function filtersHtml() {
    const options = geo.data?.options || {
      products: [],
      ufs: [],
      stations: [],
    };
    const management = geo.data?.canManage
      ? `<div class="panel"><div class="toolbar"><div><h2>Vinculação de placas</h2><p class="note">Depois de cadastrar ou corrigir uma placa na Frota, execute esta ação para atualizar os abastecimentos Ticketlog. As rotas rodoviárias são calculadas automaticamente.</p></div><div class="actions"><button class="btn primary" id="geoReprocess">Reprocessar vínculos de placas</button></div></div></div>`
      : "";
    const opportunityFilter =
      geo.tab === "fuelings"
        ? `<div class="field"><label>Oportunidades</label><select id="geoOpportunity">${option("", "Todos os abastecimentos", geo.filters.opportunity)}${option("yes", "Somente com oportunidade", geo.filters.opportunity)}</select></div>`
        : "";
    return `<div class="panel"><div class="form-grid geo-filter-grid"><div class="field"><label>Data inicial</label><input type="date" id="geoFrom" value="${esc(geo.filters.from)}"></div><div class="field"><label>Data final</label><input type="date" id="geoTo" value="${esc(geo.filters.to)}"></div><div class="field"><label>Origem</label><select id="geoOrigin">${[["", "Todas"], ["DirectFuel", "DirectFuel"], ["Ticketlog", "Ticketlog"]].map(([value, label]) => option(value, label, geo.filters.origin)).join("")}</select></div><div class="field"><label>UF</label><select id="geoUf">${option("", "Todas", geo.filters.uf)}${options.ufs.map((item) => option(item, item, geo.filters.uf)).join("")}</select></div><div class="field"><span id="geoProductLabel">Produtos</span><details id="geoProduct" style="border:1px solid #cbd5d1;border-radius:6px;padding:8px;background:white"><summary id="geoProductSummary" style="cursor:pointer">${geo.filters.product.length?`${geo.filters.product.length} produto(s) selecionado(s)`:"Todos os produtos"}</summary><div role="group" aria-labelledby="geoProductLabel" style="max-height:220px;overflow:auto;padding-top:8px">${options.products.map(item=>`<label style="display:flex;align-items:center;gap:8px;padding:5px 0"><input type="checkbox" name="geoProductChoice" value="${esc(item)}" ${geo.filters.product.includes(item)?"checked":""} style="width:auto">${esc(item)}</label>`).join("")||"Nenhum produto disponível."}</div><button type="button" class="btn small secondary" id="geoAllProducts">Todos os produtos</button><p class="muted" style="margin:6px 0 0">Sem marcações = todos os produtos.</p></details></div><div class="field"><label>Situação Ticketlog</label><select id="geoStatus">${[["", "Todas"], ...Object.entries(statusInfo).filter(([key]) => !key.startsWith("directfuel_")).map(([key, value]) => [key, value[0]])].map(([value, label]) => option(value, label, geo.filters.status)).join("")}</select></div><div class="field"><label>Posto</label><select id="geoStation">${option("", "Todos", geo.filters.station)}${options.stations.map((item) => option(item.station_code, `${item.source || "Ticketlog"} · ${item.station_name} · ${item.city}/${item.uf}`, geo.filters.station)).join("")}</select></div><div class="field"><label>Volume mínimo do posto (L)</label><input type="number" min="0" step="1000" id="geoMinLiters" value="${esc(geo.filters.minLiters)}" placeholder="Ex.: 10000"></div><div class="field"><label>Volume máximo do posto (L)</label><input type="number" min="0" step="1000" id="geoMaxLiters" value="${esc(geo.filters.maxLiters)}" placeholder="Ex.: 100000"></div>${opportunityFilter}</div><div class="toolbar geo-toolbar"><button class="btn primary" id="geoApply">Aplicar filtros</button><button class="btn secondary" id="geoClear">Limpar</button><button class="btn secondary" id="geoRefresh">Atualizar</button><button class="btn secondary" id="geoExcel">Excel</button><button class="btn secondary" id="geoPdf">PDF one page</button><button class="btn secondary" id="geoJson">GeoJSON</button><button class="btn secondary" id="geoKml">KML</button></div></div>${management}`;
  }

  function summaryHtml() {
    const s = geo.data?.summary || {},
      d = geo.data?.directFuelSummary || {},
      cards = [
        [
          "Abastecimentos integrados",
          count(s.records),
          `${dateBR(s.first_date || "")} a ${dateBR(s.last_date || "")}`,
          "hero",
        ],
        [
          "Pendente de placa",
          count(s.pending_plate),
          `${pct(s.pending_plate, s.records)} · Ver ocorrências`,
          "warn",
          "pending_plate",
        ],
        [
          "Posto sem coordenadas",
          count(s.station_no_coordinates_stations),
          `${count(s.station_no_coordinates)} abastecimentos afetados · Ver`,
          "bad",
          "station_no_coordinates",
        ],
        [
          "Revisar vínculo de posto",
          count(s.station_match_review_stations),
          `${count(s.station_match_review)} abastecimentos afetados · Ver`,
          "warn",
          "station_match_review",
        ],
        [
          "Com DirectFuel próximo",
          count(s.with_nearby_station),
          pct(s.with_nearby_station, s.records),
          "good",
        ],
        [
          "Com acordo válido",
          count(s.with_valid_agreement),
          "Abastecimentos vinculados a acordo na data",
          "good",
        ],
        [
          "Oportunidades dentro do raio",
          count(s.opportunities),
          `${num(s.opportunity_liters)} L`,
          "hero",
        ],
        [
          "Abastecimentos DirectFuel",
          count(d.records),
          `${num(d.liters)} L · ${count(d.stations)} postos`,
          "good",
        ],
        [
          "DirectFuel sem coordenadas",
          count(d.pending_coordinates),
          pct(d.pending_coordinates, d.records),
          numeric(d.pending_coordinates) ? "warn" : "good",
        ],
        [
          "Saving bruto",
          money(s.gross_saving),
          `${count(s.opportunities)} oportunidades dentro do raio`,
          "",
        ],
      ];
    return `<div class="grid cards geo-real-kpis">${cards.map((item) => `<div class="card ${item[3]} ${item[4] ? "geo-kpi-action" : ""}" ${item[4] ? `data-geo-pending="${item[4]}" role="button" tabindex="0"` : ""}><div class="label">${item[0]}</div><div class="value">${item[1]}</div><div class="delta">${item[2]}</div></div>`).join("")}</div>`;
  }

  function stationPoints() {
    const map = new Map();
    const rows = [
      ...(geo.data?.rows || []),
      ...(geo.data?.directFuelRows || []),
    ];
    for (const row of rows) {
      if (!numeric(row.latitude) || !numeric(row.longitude)) continue;
      const source = row.source || "Ticketlog",
        key = `${source}|${row.station_code}`,
        current = map.get(key) || {
          code: row.station_code,
          name: row.station_name,
          city: row.city,
          uf: row.uf,
          lat: numeric(row.latitude),
          lng: numeric(row.longitude),
          liters: 0,
          value: 0,
          records: 0,
          opportunityLiters: 0,
          grossSaving: 0,
          bestGrossSaving: Number.NEGATIVE_INFINITY,
          bestAlternativeCode: "",
          bestAlternativeName: "",
          bestAlternativeCity: "",
          bestAlternativeUf: "",
          bestDirectFuelPrice: 0,
          bestTicketlogPrice: 0,
          bestRoadDistanceKm: 0,
          bestStationMatchLabel: "",
          plateSet: new Set(),
          source,
        };
      current.liters += numeric(row.liters);
      current.value += numeric(row.final_value);
      current.records++;
      if (row.plate) current.plateSet.add(String(row.plate));
      const opportunityWithinRadius = row.opportunity === true && row.within_radius === true && numeric(row.road_radius_km) > 0 && numeric(row.road_distance_km) <= numeric(row.road_radius_km);
      if (opportunityWithinRadius) {
        current.opportunityLiters += numeric(row.liters);
        current.grossSaving += numeric(row.gross_saving);
        if (numeric(row.gross_saving) > current.bestGrossSaving) {
          current.bestGrossSaving = numeric(row.gross_saving);
          current.bestAlternativeCode =
            row.alternative_code || row.alternative_id || "";
          current.bestAlternativeName = row.alternative_name || "";
          current.bestAlternativeCity = row.alternative_city || "";
          current.bestAlternativeUf = row.alternative_uf || "";
          current.bestDirectFuelPrice = numeric(row.directfuel_price);
          current.bestTicketlogPrice = numeric(row.ticketlog_price);
          current.bestRoadDistanceKm = numeric(row.road_distance_km);
          current.bestStationMatchLabel = row.station_match_label || "";
        }
      }
      map.set(key, current);
    }
    return [...map.values()].map(({ plateSet, bestGrossSaving, ...row }) => ({
      ...row,
      plates: plateSet.size,
      weightedPrice: row.liters ? row.value / row.liters : 0,
    }));
  }
  function mapPoints() {
    const actual = stationPoints(),
      actualDirectFuelCodes = new Set(
        actual
          .filter((row) => row.source === "DirectFuel")
          .map((row) => String(row.code)),
      ),
      alternatives = (geo.data?.alternatives || [])
        .filter((row) => numeric(row.lat) && numeric(row.lng))
        .filter(
          (row) =>
            row.source !== "DirectFuel" ||
            !actualDirectFuelCodes.has(String(row.code)),
        )
        .map((row) => ({
          code: row.code || row.id,
          name: row.name,
          city: row.city,
          uf: row.uf,
          lat: row.lat,
          lng: row.lng,
          liters: 0,
          value: 0,
          records: 0,
          opportunityLiters: 0,
          grossSaving: 0,
          weightedPrice: 0,
          plates: 0,
          source: row.source,
          alternative: true,
        })),
      allPoints = actual.concat(alternatives),
      linkedAlternatives = new Set(
        actual
          .filter(
            (row) =>
              row.source === "Ticketlog" && row.opportunityLiters > 0,
          )
          .map((row) => String(row.bestAlternativeCode)),
      ),
      points =
        geo.mapMode === "opportunities"
          ? allPoints.filter(
              (row) =>
                (row.source === "Ticketlog" && row.opportunityLiters > 0) ||
                (row.source === "DirectFuel" &&
                  linkedAlternatives.has(String(row.code))),
            )
          : allPoints;
    return points;
  }

  function spreadCoincidentPoints(points) {
    const groups = new Map();
    points.forEach((row) => {
      const key = `${numeric(row.lat).toFixed(5)}|${numeric(row.lng).toFixed(5)}`,
        group = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    });
    return points.map((row) => {
      const key = `${numeric(row.lat).toFixed(5)}|${numeric(row.lng).toFixed(5)}`,
        group = groups.get(key) || [],
        ordered = [...group].sort(
          (left, right) =>
            ["Ticketlog", "DirectFuel", "Parceiro", "Interno"].indexOf(left.source) -
              ["Ticketlog", "DirectFuel", "Parceiro", "Interno"].indexOf(right.source) ||
            String(left.code).localeCompare(String(right.code)),
        ),
        index = ordered.indexOf(row);
      if (group.length < 2)
        return {
          ...row,
          displayLat: numeric(row.lat),
          displayLng: numeric(row.lng),
          markerOffsetX: 0,
          markerOffsetY: 0,
        };
      const angle =
          group.length === 2
            ? index === 0
              ? Math.PI * 0.9
              : -Math.PI * 0.1
            : (Math.PI * 2 * index) / group.length - Math.PI / 2,
        offset = group.length === 2 ? 13 : 22;
      return {
        ...row,
        displayLat: numeric(row.lat),
        displayLng: numeric(row.lng),
        markerOffsetX: Math.round(Math.cos(angle) * offset),
        markerOffsetY: Math.round(Math.sin(angle) * offset),
        coincidentSources: [...new Set(group.map((item) => item.source))],
      };
    });
  }

  function clearOpportunityTransfer() {
    if (!geo.leafletMap) return;
    if (geo.opportunityLine) {
      geo.leafletMap.removeLayer(geo.opportunityLine);
      geo.opportunityLine = null;
    }
    if (geo.opportunityDirectionMarker) {
      geo.leafletMap.removeLayer(geo.opportunityDirectionMarker);
      geo.opportunityDirectionMarker = null;
    }
    geo.activeOpportunity = null;
  }

  function markerDisplayLatLng(row) {
    const map = geo.leafletMap,
      base = map.latLngToLayerPoint([numeric(row.lat), numeric(row.lng)]),
      shifted = base.add([
        numeric(row.markerOffsetX),
        numeric(row.markerOffsetY),
      ]);
    return map.layerPointToLatLng(shifted);
  }

  function drawOpportunityTransfer(row, points, focus = true) {
    const map = geo.leafletMap,
      L = window.L,
      target = points.find(
        (point) =>
          point.source === "DirectFuel" &&
          String(point.code) === String(row.bestAlternativeCode),
      );
    if (!map || !L || !target) {
      toast("Alternativa DirectFuel não localizada no mapa");
      return;
    }
    clearOpportunityTransfer();
    const start = markerDisplayLatLng(row),
      end = markerDisplayLatLng(target),
      startPoint = map.latLngToLayerPoint(start),
      endPoint = map.latLngToLayerPoint(end),
      middlePoint = L.point(
        (startPoint.x + endPoint.x) / 2,
        (startPoint.y + endPoint.y) / 2,
      ),
      middle = map.layerPointToLatLng(middlePoint),
      angle =
        (Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x) *
          180) /
        Math.PI;
    geo.opportunityLine = L.polyline([start, end], {
      color: "#f4b400",
      weight: 6,
      opacity: 0.96,
      dashArray: "11 8",
      lineCap: "round",
      className: "geo-opportunity-route",
    }).addTo(map);
    geo.opportunityLine.bindTooltip(
      `<strong>Transferência de oportunidade</strong><br>${esc(row.name)} → ${esc(target.name)}<br>${num(row.opportunityLiters)} L · ${num(row.bestRoadDistanceKm)} km`,
      { sticky: true },
    );
    geo.opportunityDirectionMarker = L.marker(middle, {
      interactive: false,
      zIndexOffset: 3000,
      icon: L.divIcon({
        className: "geo-route-direction-icon",
        html: `<span class="geo-route-direction" style="--route-angle:${angle}deg">➜</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
    }).addTo(map);
    geo.activeOpportunity = { row, target, points };
    if (focus) {
      const sameLocation =
        Math.abs(numeric(row.lat) - numeric(target.lat)) < 0.00001 &&
        Math.abs(numeric(row.lng) - numeric(target.lng)) < 0.00001;
      if (sameLocation)
        map.setView(
          [numeric(row.lat), numeric(row.lng)],
          Math.max(map.getZoom(), 15),
        );
      else
        map.fitBounds(
          [
            [numeric(row.lat), numeric(row.lng)],
            [numeric(target.lat), numeric(target.lng)],
          ],
          { padding: [70, 70], maxZoom: 13 },
        );
    }
  }

  function showMapPointDetail(row, points) {
    const panel = $("#geoMapDetail");
    if (!panel) return;
    const opportunityShare = row.liters
        ? (numeric(row.opportunityLiters) / numeric(row.liters)) * 100
        : 0,
      priceDifference =
        numeric(row.bestTicketlogPrice) - numeric(row.bestDirectFuelPrice),
      priceDifferencePct = row.bestTicketlogPrice
        ? (priceDifference / numeric(row.bestTicketlogPrice)) * 100
        : 0,
      hasOpportunity = numeric(row.opportunityLiters) > 0;
    panel.classList.add("open");
    panel.innerHTML = `<div class="geo-map-detail-head"><div><span class="geo-map-detail-source">${esc(row.source)}</span><h3>${esc(row.name)}</h3><small>${esc(row.city)}/${esc(row.uf)} · ${esc(row.code)}</small></div><button class="geo-map-detail-close" type="button" aria-label="Fechar detalhes">×</button></div><div class="geo-map-detail-grid"><div><span>Volume no período</span><b>${num(row.liters)} L</b></div><div><span>Valor no período</span><b>${money(row.value)}</b></div><div><span>Preço médio ponderado</span><b>${money(row.weightedPrice)}</b></div><div><span>Abastecimentos</span><b>${count(row.records)}</b></div><div><span>Placas</span><b>${count(row.plates)}</b></div><div><span>Coordenadas</span><b>${numeric(row.lat).toFixed(5)}, ${numeric(row.lng).toFixed(5)}</b></div></div>${hasOpportunity ? `<div class="geo-map-opportunity"><span>Oportunidade identificada</span><strong>${num(row.opportunityLiters)} L</strong><small>${opportunityShare.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do volume deste posto</small></div><div class="geo-map-detail-list"><div><span>Melhor alternativa</span><b>${esc(row.bestAlternativeName || row.bestAlternativeCode)}</b></div><div><span>Vínculo geográfico</span><b>${esc(row.bestStationMatchLabel || "Raio rodoviário")}</b></div><div><span>Preço Ticketlog</span><b>${money(row.bestTicketlogPrice)}</b></div><div><span>Preço DirectFuel</span><b>${money(row.bestDirectFuelPrice)}</b></div><div><span>Diferença por litro</span><b>${money(priceDifference)} · ${priceDifferencePct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b></div><div><span>Distância rodoviária</span><b>${num(row.bestRoadDistanceKm)} km</b></div><div><span>Saving bruto potencial</span><b>${money(row.grossSaving)}</b></div></div>` : `<div class="note">Não há oportunidade econômica classificada para este posto nos filtros atuais.</div>`}<div class="geo-map-detail-actions">${row.source === "Ticketlog" ? `<button class="btn primary" id="geoDetailSameRoad" type="button">Analisar oportunidades</button><button class="btn secondary" id="geoDetailFuelings" type="button">Ver abastecimentos</button>` : ""}</div>`;
    const bestAlternative = [...panel.querySelectorAll(".geo-map-detail-list > div")]
      .find((item) => item.querySelector("span")?.textContent === "Melhor alternativa");
    if (bestAlternative && (row.bestAlternativeCode || row.bestAlternativeCity)) {
      const detail = document.createElement("small");
      detail.className = "muted";
      detail.textContent = `${row.bestAlternativeCity || "-"}/${row.bestAlternativeUf || "-"} · ${row.bestAlternativeCode || "-"}`;
      bestAlternative.querySelector("b")?.append(document.createElement("br"), detail);
    }
    panel.querySelector(".geo-map-detail-close").onclick = () => {
      panel.classList.remove("open");
      clearOpportunityTransfer();
    };
    const sameRoad = panel.querySelector("#geoDetailSameRoad");
    if (sameRoad) sameRoad.onclick = () => openSameRoadAnalysis(row.code);
    const fuelings = panel.querySelector("#geoDetailFuelings");
    if (fuelings)
      fuelings.onclick = () => {
        geo.tab = "fuelings";
        geo.filters.station = row.code;
        geo.filters.origin = "Ticketlog";
        loadData();
      };
    clearOpportunityTransfer();
  }

  function initLeafletMap(attempt = 0) {
    const container = $("#geoLeafletMap"),
      L = window.L;
    if (!container || route !== "analysis_geo" || geo.tab !== "overview") return;
    if (!L) {
      if (attempt < 30) setTimeout(() => initLeafletMap(attempt + 1), 200);
      else container.innerHTML = '<div class="geo-empty">Não foi possível carregar a base cartográfica.</div>';
      return;
    }
    if (geo.leafletMap) {
      geo.leafletMap.remove();
      geo.leafletMap = null;
      geo.opportunityLine = null;
      geo.opportunityDirectionMarker = null;
      geo.activeOpportunity = null;
    }
    const points = spreadCoincidentPoints(mapPoints());
    if (!points.length) {
      container.innerHTML = '<div class="geo-empty">Nenhum posto com coordenadas válidas para a seleção.</div>';
      return;
    }
    const map = L.map(container, { zoomControl: true, scrollWheelZoom: true });
    geo.leafletMap = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const actual = points.filter((row) => !row.alternative),
      maxVolume = Math.max(1, ...actual.map((row) => numeric(row.liters))),
      bounds = [];
    if (geo.heatmap)
      actual.forEach((row) => {
        const intensity = Math.sqrt(numeric(row.liters) / maxVolume),
          heatColor = row.source === "Ticketlog" ? "#f59e0b" : "#0f8b68";
        L.circleMarker([numeric(row.lat), numeric(row.lng)], {
          radius: 24 + intensity * 48,
          stroke: true,
          color: heatColor,
          weight: 2,
          opacity: 0.72,
          fillColor: heatColor,
          fillOpacity: 0.2 + intensity * 0.2,
          interactive: false,
        }).addTo(map);
      });
    points.forEach((row) => {
      const lat = numeric(row.lat),
        lng = numeric(row.lng),
        displayLat = numeric(row.displayLat),
        displayLng = numeric(row.displayLng),
        opportunityShare = row.liters
          ? numeric(row.opportunityLiters) / numeric(row.liters)
          : 0,
        color =
          {
            Ticketlog: "#2563eb",
            DirectFuel: "#0f8b68",
            Parceiro: "#e58b3a",
            Interno: "#7f56d9",
          }[row.source] || "#64748b",
        sourceLetter =
          { Ticketlog: "T", DirectFuel: "D", Parceiro: "P", Interno: "I" }[
            row.source
          ] || "•",
        hasOpportunity =
          row.source === "Ticketlog" && numeric(row.opportunityLiters) > 0,
        volumeScale = row.alternative
          ? 0
          : Math.sqrt(Math.max(0, numeric(row.liters)) / maxVolume),
        iconSize = row.alternative ? 28 : Math.round(30 + volumeScale * 26),
        markerClass = `geo-station-marker${hasOpportunity ? " has-opportunity" : ""}${opportunityShare >= 0.5 ? " high-opportunity" : ""}`,
        markerOffsetX = numeric(row.markerOffsetX),
        markerOffsetY = numeric(row.markerOffsetY),
        icon = L.divIcon({
          className: "geo-station-icon",
          html: `<span class="${markerClass}" style="--marker-color:${color};--marker-x:${markerOffsetX}px;--marker-y:${markerOffsetY}px;--marker-font:${Math.round(iconSize * 0.42)}px"><b>${sourceLetter}</b>${hasOpportunity ? '<i class="geo-opportunity-trigger" title="Traçar transferência da oportunidade" aria-label="Traçar transferência da oportunidade" role="button" tabindex="0">$</i>' : ""}</span>`,
          iconSize: [iconSize, iconSize + 6],
          iconAnchor: [iconSize / 2, iconSize + 3],
          tooltipAnchor: [markerOffsetX, markerOffsetY - iconSize],
        }),
        marker = L.marker([displayLat, displayLng], {
          icon,
          riseOnHover: true,
          riseOffset: 1000,
          zIndexOffset:
            1000 - iconSize +
            ({ Ticketlog: 10, DirectFuel: 30, Parceiro: 20, Interno: 20 }[
              row.source
            ] || 0),
          title: `${row.source}: ${row.name}`,
        }).addTo(map);
      marker.bindTooltip(
        `${esc(row.name)} · ${num(row.liters)} L${row.opportunityLiters ? ` · ${num(row.opportunityLiters)} L com oportunidade` : ""}`,
        { direction: "top" },
      );
      marker.on("click", () => showMapPointDetail(row, points));
      const opportunityButton = marker
        .getElement()
        ?.querySelector(".geo-opportunity-trigger");
      if (opportunityButton) {
        L.DomEvent.disableClickPropagation(opportunityButton);
        const traceOpportunity = (event) => {
          event.preventDefault();
          event.stopPropagation();
          showMapPointDetail(row, points);
          drawOpportunityTransfer(row, points, true);
        };
        opportunityButton.addEventListener("click", traceOpportunity);
        opportunityButton.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ")
            traceOpportunity(event);
        });
      }
      bounds.push([lat, lng]);
    });
    map.on("zoomend", () => {
      const active = geo.activeOpportunity;
      if (active)
        drawOpportunityTransfer(active.row, active.points, false);
    });
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
    setTimeout(() => map.invalidateSize(), 100);
  }

  async function openSameRoadAnalysis(stationCode) {
    const back = document.createElement("div");
    back.className = "modal-back geo-road-backdrop";
    back.innerHTML = `<div class="modal geo-road-modal"><div class="modal-head"><div><h2>Análise de oportunidades</h2><p class="muted">Consultando alternativas, acordos, preços e trechos reais da rota...</p></div><button class="btn secondary geoRoadClose" type="button">Fechar</button></div><div class="geo-road-body"><div class="geo-processing"><strong>Calculando oportunidades e normalizando rodovias</strong><span>Referências como BR-101 e BR 101 são tratadas como a mesma rodovia.</span></div></div></div>`;
    const host =
      document.fullscreenElement instanceof HTMLElement
        ? document.fullscreenElement
        : document.body;
    host.appendChild(back);
    const close = () => back.remove();
    back.querySelector(".geoRoadClose").onclick = close;
    back.onclick = (event) => {
      if (event.target === back) close();
    };
    try {
      const response = await fetch("/api/geo-analysis", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "same-road-analysis",
            stationCode,
            from: geo.filters.from,
            to: geo.filters.to,
            product: geo.filters.product,
          }),
        }),
        payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Não foi possível analisar a rodovia");
      const body = back.querySelector(".geo-road-body"),
        originRoads = payload.origin?.roads || [],
        results = payload.results || [];
      body.innerHTML = `<div class="geo-road-summary"><div><span>Posto Ticketlog</span><strong>${esc(payload.origin?.station_name || stationCode)}</strong><small>${esc(payload.origin?.city)}/${esc(payload.origin?.uf)}</small></div><div><span>Rodovia identificada</span><strong>${originRoads.map(esc).join(" · ") || "Não identificada"}</strong><small>Trechos iniciais das rotas consultadas</small></div><div><span>Raio rodoviário</span><strong>${num(payload.roadRadiusKm)} km</strong><small>Distância somente de ida</small></div><div><span>Produtos</span><strong>${(payload.products || []).map(esc).join(", ") || "Não informado"}</strong><small>Seleção atual</small></div></div><div class="geo-road-controls"><label class="geo-road-only"><input type="checkbox" id="geoRoadOnly"> Somente postos na mesma rodovia</label><span class="muted">O filtro mantém apenas resultados dentro do raio de ${num(payload.roadRadiusKm)} km.</span></div><div class="table-wrap"><table><thead><tr><th>Posto DirectFuel</th><th>Classificação</th><th>Trecho compartilhado</th><th>Distância de ida</th><th>Produto e acordo</th><th>Preços</th><th>Saving bruto</th></tr></thead><tbody id="geoRoadRows"></tbody></table></div>`;
      const draw = () => {
        const onlySame = back.querySelector("#geoRoadOnly")?.checked,
          visible = results.filter(
            (item) => !onlySame || (item.same_road && item.within_radius),
          ),
          rows = back.querySelector("#geoRoadRows");
        rows.innerHTML =
          visible
            .map((item) => {
              const comparisons = item.product_comparisons || [],
                agreement = comparisons.length
                  ? comparisons
                      .map(
                        (entry) =>
                          `<div><strong>${esc(entry.product)} → ${esc(entry.directfuel_product || "-")}</strong><br><span class="badge ${entry.product_match_type === "exact" ? "ok" : entry.product_match_type === "compatible_review" ? "bad" : "warn"}">${esc(entry.product_match_label)}</span><br><span class="muted">${entry.agreement_number ? `Acordo ${esc(entry.agreement_number)} · ` : ""}${esc(entry.agreement_status)}</span></div>`,
                      )
                      .join("")
                  : '<span class="badge bad">Sem acordo válido</span>',
                prices = comparisons.length
                  ? comparisons
                      .map(
                        (entry) =>
                          `<div>T: ${money(entry.ticketlog_price)}<br>D: ${entry.directfuel_price ? money(entry.directfuel_price) : "-"}</div>`,
                      )
                      .join("")
                  : "-",
                shared = (item.common_roads || []).length
                  ? item.common_roads.map(esc).join(" · ")
                  : item.corridor_with_connection
                    ? (item.route_roads || []).slice(0, 4).map(esc).join(" · ")
                    : "-",
                classificationClass = item.same_road
                  ? "ok"
                  : item.corridor_with_connection
                    ? "warn"
                    : item.coordinate_conflict
                      ? "bad"
                      : "",
                scopeLabel = item.coordinate_conflict
                  ? "Fora da análise até corrigir o cadastro"
                  : `${item.within_radius ? "Dentro" : "Fora"} do raio`,
                sharedDetail = item.coordinate_conflict
                  ? `<span class="badge bad">${esc(item.error)}</span>`
                  : shared;
              return `<tr><td><strong>${esc(item.alternative_name)}</strong><br><span class="muted">${esc(item.city)}/${esc(item.uf)} · ${esc(item.alternative_code)}</span></td><td><span class="badge ${classificationClass}">${esc(item.classification)}</span><br><span class="muted">${scopeLabel}</span></td><td>${sharedDetail}</td><td>${item.error ? "-" : `${num(item.road_distance_km)} km<br><span class="muted">${count(Math.round(numeric(item.duration_minutes)))} min</span>`}</td><td>${agreement}</td><td>${prices}</td><td>${item.within_radius && comparisons.length ? money(item.gross_saving) : '<span class="muted">Fora do raio</span>'}</td></tr>`;
            })
            .join("") ||
          '<tr><td colspan="7" class="muted">Nenhum posto encontrado para este filtro e raio.</td></tr>';
      };
      back.querySelector("#geoRoadOnly").onchange = draw;
      draw();
    } catch (error) {
      const body = back.querySelector(".geo-road-body");
      body.innerHTML = `<div class="note"><strong>Não foi possível concluir.</strong><br>${esc(error.message || "Falha na análise de rodovia")}</div>`;
    }
  }

  async function toggleMapFullscreen() {
    const panel = $(".geo-map-panel"),
      button = $("#geoFullscreen");
    if (!panel) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panel.requestFullscreen();
      if (button)
        button.textContent = document.fullscreenElement
          ? "Sair da tela cheia"
          : "Tela cheia";
      setTimeout(() => geo.leafletMap?.invalidateSize(), 120);
    } catch (error) {
      toast("Não foi possível abrir o mapa em tela cheia");
    }
  }

  function topOpportunities() {
    return (geo.data?.groups?.stations || [])
      .filter((row) => numeric(row.opportunities))
      .sort((a, b) => numeric(b.grossSaving) - numeric(a.grossSaving))
      .slice(0, 10);
  }
  function overviewTab() {
    const s = geo.data?.summary || {},
      d = geo.data?.directFuelSummary || {},
      tops = topOpportunities();
    return `${summaryHtml()}<div class="geo-layout"><div class="panel geo-map-panel"><div class="geo-map-head"><div><h2>Distribuição real dos abastecimentos</h2><span class="muted">As letras identificam o meio de abastecimento, o tamanho representa o volume e pontos coincidentes aparecem lado a lado.</span></div><div class="geo-map-head-actions"><div class="geo-legend"><span><i class="geo-letter ticketlog">T</i>Ticketlog</span><span><i class="geo-letter directfuel">D</i>DirectFuel</span><span><i class="geo-letter partner">P</i>Parceiro</span><span><i class="geo-letter internal">I</i>Interno</span><span><i class="geo-opportunity-key">$</i>Oportunidade</span></div><button class="btn secondary geo-map-mode ${geo.mapMode === "network" ? "active" : ""}" data-geomode="network">Rede completa</button><button class="btn secondary geo-map-mode ${geo.mapMode === "opportunities" ? "active" : ""}" data-geomode="opportunities">Plano de migração</button><button class="btn secondary ${geo.heatmap ? "geo-map-mode active" : ""}" id="geoHeatmap">Concentração de volume</button><button class="btn secondary" id="geoFullscreen">Tela cheia</button></div></div><div class="geo-map" id="geoLeafletMap" aria-label="Mapa interativo dos postos georreferenciados"></div><aside class="geo-map-detail" id="geoMapDetail" aria-live="polite"></aside></div><div class="geo-side"><div class="panel"><h2>Leitura econômica</h2><div class="geo-stat"><span>Volume Ticketlog</span><b>${num(s.liters)} L</b></div><div class="geo-stat"><span>Valor Ticketlog</span><b>${money(s.value)}</b></div><div class="geo-stat"><span>Preço médio ponderado Ticketlog</span><b>${money(s.liters ? numeric(s.value) / numeric(s.liters) : 0)}</b></div><div class="geo-stat"><span>Volume DirectFuel</span><b>${num(d.liters)} L</b></div><div class="geo-stat"><span>Valor DirectFuel</span><b>${money(d.value)}</b></div><div class="geo-stat"><span>Preço médio ponderado DirectFuel</span><b>${money(d.liters ? numeric(d.value) / numeric(d.liters) : 0)}</b></div><div class="geo-stat"><span>Oportunidade em litros Ticketlog → DirectFuel</span><b>${num(s.opportunity_liters)} L</b></div><div class="geo-stat total"><span>Saving bruto potencial</span><b>${money(s.gross_saving)}</b></div><p class="muted">Os preços médios são ponderados pelo volume. O saving bruto considera o preço, o produto compatível, o acordo vigente na data e a distância rodoviária calculada automaticamente.</p></div><div class="panel"><h2>Maiores oportunidades</h2>${tops.map((row, index) => `<div class="geo-rank"><span>${index + 1}. ${esc(row.label)}</span><b>${money(row.grossSaving)}</b></div>`).join("") || '<p class="muted">Complete os cadastros de placas, coordenadas e acordos para gerar oportunidades.</p>'}</div></div></div>`;
  }

  function analysisTable(rows, title) {
    return `<div class="panel"><div class="geo-detail-title"><div><h2>${esc(title)}</h2><p class="muted">Produtos idênticos são priorizados. S-10 comum e S-10 aditivado aparecem como compatíveis, sem ocultar a diferença.</p></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Placa</th><th>Posto Ticketlog</th><th>Produto Ticketlog</th><th>Produto DirectFuel</th><th>Compatibilidade</th><th>Alternativa DirectFuel</th><th>Vínculo geográfico</th><th>Preço Ticketlog</th><th>Preço DirectFuel</th><th>Distância de ida</th><th>Enquadramento</th><th>Saving bruto</th><th>Classificação</th><th>Situação</th></tr></thead><tbody>${rows.map((row) => { const economic = ["ready", "outside_radius"].includes(row.analysis_status), matchClass = row.product_match_type === "exact" ? "ok" : row.product_match_type === "compatible_review" ? "bad" : "warn"; return `<tr><td>${dateBR(row.occurred_on)}</td><td>${esc(row.plate)}</td><td>${esc(row.station_name)}<br><span class="muted">${esc(row.city)}/${esc(row.uf)} · ${esc(row.station_code)}</span></td><td>${esc(row.product || "-")}</td><td>${esc(row.directfuel_product || "-")}</td><td>${row.product_match_label ? `<span class="badge ${matchClass}">${esc(row.product_match_label)}</span>` : "-"}</td><td>${esc(row.alternative_name || "-")}<br><span class="muted">${esc(row.alternative_city || "-")}/${esc(row.alternative_uf || "-")} · ${esc(row.alternative_code || "-")}</span></td><td>${esc(row.station_match_label || "-")}</td><td>${row.ticketlog_price ? money(row.ticketlog_price) : "-"}</td><td>${row.directfuel_price ? money(row.directfuel_price) : "-"}</td><td>${economic ? `${num(row.road_distance_km)} km` : "-"}</td><td>${economic ? `${row.within_radius ? "Dentro" : "Fora"} do raio de ${num(row.road_radius_km)} km` : "-"}</td><td>${economic ? money(row.gross_saving) : "-"}</td><td>${esc(row.opportunity_level || "-")}</td><td>${statusBadge(row.analysis_status)}</td></tr>`; }).join("") || '<tr><td colspan="15" class="muted">Nenhum registro encontrado.</td></tr>'}</tbody></table></div></div>`;
  }
  function fuelingsTab() {
    const directRows = geo.data?.directFuelRows || [],
      directTable = `<div class="panel"><div class="geo-detail-title"><div><h2>Abastecimentos DirectFuel integrados</h2><p class="muted">A coordenada é herdada do posto operacional vinculado ao abastecimento.</p></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Placa</th><th>Posto DirectFuel</th><th>Produto</th><th>Unidade</th><th>Centro de custo</th><th>Volume</th><th>Preço</th><th>Valor</th><th>Georreferência</th></tr></thead><tbody>${directRows.map((row) => `<tr><td>${dateBR(row.occurred_on)}</td><td>${esc(row.plate)}</td><td>${esc(row.station_name)}<br><span class="muted">${esc(row.city)}/${esc(row.uf)}</span></td><td>${esc(row.product || "-")}</td><td>${esc(row.unit_name || "-")}</td><td>${esc(row.cost_center || "-")}</td><td>${num(row.liters)} L</td><td>${money(row.final_price)}</td><td>${money(row.final_value)}</td><td>${statusBadge(row.analysis_status)}</td></tr>`).join("") || '<tr><td colspan="10" class="muted">Nenhum abastecimento DirectFuel para os filtros.</td></tr>'}</tbody></table></div></div>`;
    return `${summaryHtml()}${directTable}${analysisTable(geo.data?.rows || [], "Abastecimentos Ticketlog integrados")}`;
  }

  function consolidatedTab() {
    const groups = geo.data?.groups || {},
      choices = [
        ["stations", "Posto"],
        ["plates", "Placa"],
        ["units", "Unidade"],
        ["costCenters", "Centro de custo"],
        ["periods", "Período"],
      ],
      rows = groups[geo.group] || [];
    return `${summaryHtml()}<div class="panel"><div class="geo-detail-title"><div><h2>Consolidação analítica</h2><p class="muted">Selecione a visão gerencial desejada.</p></div><div class="geo-group-switch">${choices.map(([key, label]) => `<button class="btn small ${geo.group === key ? "primary" : "secondary"}" data-geogroup="${key}">${label}</button>`).join("")}</div></div><div class="table-wrap"><table><thead><tr><th>Grupo</th><th>Abastecimentos</th><th>Oportunidades</th><th>Volume</th><th>Valor Ticketlog</th><th>Saving bruto</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${esc(row.label)}</strong></td><td>${count(row.records)}</td><td>${count(row.opportunities)}</td><td>${num(row.liters)} L</td><td>${money(row.value)}</td><td>${money(row.grossSaving)}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">Sem dados para esta consolidação.</td></tr>'}</tbody></table></div></div>`;
  }

  function pendingPlateTable(rows) {
    const plates = new Map();
    rows.forEach((row) => {
      const key = row.plate || "Placa não informada",
        current = plates.get(key) || {
          plate: key,
          reason: row.plate_pending_reason || "Placa sem vínculo com a Frota",
          action: row.plate_pending_action || "Revisar o cadastro da Frota",
          model: row.vehicle_model || "",
          transaction: row.transaction_code || "",
          first: row.occurred_on || "",
          last: row.occurred_on || "",
          records: 0,
          liters: 0,
        };
      current.records++;
      current.liters += numeric(row.liters);
      if (row.occurred_on && (!current.first || row.occurred_on < current.first)) current.first = row.occurred_on;
      if (row.occurred_on && (!current.last || row.occurred_on > current.last)) current.last = row.occurred_on;
      plates.set(key, current);
    });
    const values = [...plates.values()].sort((a, b) => b.records - a.records || b.liters - a.liters);
    return `<div class="panel"><div class="geo-detail-title"><div><h2>Pendentes de placa · ${count(rows.length)}</h2><p class="muted">${count(values.length)} placas diferentes. O motivo abaixo indica se é necessário cadastrar a placa ou apenas atualizar o vínculo.</p></div>${geo.data?.canManage ? '<div class="actions"><button class="btn secondary" id="geoOpenFleetPending">Abrir cadastro da Frota</button><button class="btn primary" id="geoReprocessPending">Atualizar vínculos pendentes</button></div>' : ""}</div><div class="table-wrap"><table><thead><tr><th>Placa recebida</th><th>Motivo da pendência</th><th>Ação recomendada</th><th>Modelo recebido</th><th>Exemplo de transação</th><th>Período</th><th>Registros</th><th>Volume</th></tr></thead><tbody>${values.slice(0, 200).map((row) => `<tr><td><strong>${esc(row.plate)}</strong></td><td>${esc(row.reason)}</td><td>${esc(row.action)}</td><td>${esc(row.model || "-")}</td><td>${esc(row.transaction || "-")}</td><td>${row.first ? `${dateBR(row.first)} a ${dateBR(row.last)}` : "-"}</td><td>${count(row.records)}</td><td>${num(row.liters)} L</td></tr>`).join("") || '<tr><td colspan="8" class="muted">Nenhuma pendência de placa.</td></tr>'}</tbody></table></div>${values.length > 200 ? `<p class="note">Exibindo as 200 placas com mais ocorrências. Use a exportação Excel para consultar a lista completa.</p>` : ""}</div>`;
  }

  function reviewStation(code) {
    const row = (geo.data?.rows || []).find(item => item.station_code === code) || {};
    const previous = (geo.data?.stationReviews || []).find(item => item.stationCode === code);
    const candidates = [...new Map((geo.data?.alternatives || []).filter(item => item.source === "DirectFuel" && item.operationalId).map(item => [item.operationalId, item])).values()];
    candidates.sort((a,b) => Number(b.city === row.city) - Number(a.city === row.city) || String(a.name).localeCompare(String(b.name)));
    modal("Revisar vínculo do posto", `<p><strong>${esc(row.station_name || code)}</strong><br>${esc(row.city || "")}/${esc(row.uf || "")} · Ticketlog ${esc(code)}</p><p class="note">${esc(row.analysis_label || "Revisão manual")}<br>Confira CNPJ, endereço e localização antes de confirmar. A decisão vale para todos os abastecimentos deste código Ticketlog.</p><div class="field"><label>Decisão</label><select id="stationReviewMode"><option value="same">É o mesmo posto DirectFuel</option><option value="different">São postos diferentes</option><option value="automatic">Voltar à identificação automática</option></select></div><div class="field"><label>Posto DirectFuel</label><select id="stationReviewTarget"><option value="">Selecione o posto correto</option>${candidates.map(item => `<option value="${esc(item.operationalId)}">${esc(item.name)} · ${esc(item.code)} · ${esc(item.city)}/${esc(item.uf)}</option>`).join("")}</select></div><div class="note" id="stationReviewDetails"></div><div class="field"><label>Justificativa</label><textarea id="stationReviewReason" maxlength="1000"></textarea></div><p class="note">“São postos diferentes” desconsidera a identificação automática com os postos DirectFuel; as oportunidades continuam sendo avaliadas pela rota. Corrija coordenadas incorretas no cadastro.</p>${previous ? `<p class="note">Última decisão: ${esc(previous.reviewedBy)} · ${esc(previous.reviewedAt)}<br>${esc(previous.reason)}</p>` : ""}`, async back => {
      const mode = val("stationReviewMode"), targetId = val("stationReviewTarget"), reason = val("stationReviewReason").trim();
      if (!reason || (mode === "same" && !targetId)) return toast("Selecione o posto e informe a justificativa");
      try {
        const response = await fetch("/api/geo-analysis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "review-station", stationCode: code, mode, targetId, reason }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Não foi possível salvar");
        back.remove(); await loadData("Revisão salva e análise atualizada");
      } catch(error) { toast(error.message); }
    });
    const update = () => { const item = candidates.find(item => item.operationalId === val("stationReviewTarget")); $("#stationReviewTarget").disabled = val("stationReviewMode") !== "same"; $("#stationReviewDetails").textContent = item ? `CNPJ: ${item.cnpj || "Não informado"} · Endereço: ${item.address || "Não informado"} · Coordenadas: ${item.lat}, ${item.lng}` : ""; };
    $("#stationReviewMode").value = previous?.mode || "same";
    $("#stationReviewTarget").value = previous?.targetId || "";
    $("#stationReviewReason").value = previous?.reason || "";
    $("#stationReviewMode").onchange = update; $("#stationReviewTarget").onchange = update; update();
  }

  function pendingTab() {
    const rows = geo.data?.rows || [],
      blocks = [
        ["pending_plate", "Pendentes de placa"],
        ["station_no_coordinates", "Postos sem coordenadas"],
        ["station_match_review", "Vínculos de postos para revisar"],
        ["no_nearby_station", "Sem posto DirectFuel próximo"],
        ["route_pending", "Rotas rodoviárias pendentes"],
        ["route_error", "Rotas rodoviárias com erro"],
        ["outside_radius", "Alternativas fora do raio rodoviário"],
        ["no_valid_agreement", "Sem acordo DirectFuel válido na data"],
      ];
    const bulkAction = geo.data?.canManage
      ? `<div class="panel"><div class="toolbar"><div><h2>Geocodificação dos postos Ticketlog</h2><p class="note">Localiza em massa os postos sem coordenadas usando nome, endereço, município e UF. Coordenadas já informadas não serão alteradas.</p></div><button class="btn primary" id="geoGeocodeAll" ${geo.bulkGeocoding ? "disabled" : ""}>${geo.bulkGeocoding ? "Geocodificando..." : "Geocodificar postos em massa"}</button></div><div id="geoBulkProgress" class="note"></div></div>`
      : "";
    return `${summaryHtml()}${bulkAction}${geo.data?.canManage && geo.data?.stationReviews?.length ? `<div class="panel"><h2>Vínculos revisados manualmente</h2>${geo.data.stationReviews.map(item => `<p>Ticketlog ${esc(item.stationCode)} · ${item.mode === "same" ? "Mesmo posto confirmado" : "Postos diferentes"} <button class="btn small secondary geoReviewStation" data-code="${esc(item.stationCode)}">Alterar decisão</button></p>`).join("")}</div>` : ""}<div class="geo-pending-grid">${blocks
      .map(([key, title]) => {
        const selected = rows.filter((row) => row.analysis_status === key),
          stations = new Map();
        if (key === "pending_plate") return pendingPlateTable(selected);
        selected.forEach((row) => {
          const id = `${row.station_code}|${key}`,
            current = stations.get(id) || {
              code: row.station_code,
              name: row.station_name,
              city: row.city,
              uf: row.uf,
              records: 0,
              liters: 0,
            };
          current.records++;
          current.liters += numeric(row.liters);
          stations.set(id, current);
        });
        const hasAction = ["station_no_coordinates", "station_match_review"].includes(key) && geo.data?.canManage,
          uniqueStations = stations.size,
          retryRoutes = geo.data?.canManage && ["route_error", "route_pending"].includes(key) ? `<button class="btn small primary" id="${key === "route_pending" ? "geoCalculatePending" : "geoRetryRouteErrors"}" ${geo.routing ? "disabled" : ""}>${geo.routing ? "Calculando rotas..." : key === "route_pending" ? "Calcular rotas pendentes" : "Tentar novamente"}</button>` : "";
        return `<div class="panel"><div class="geo-detail-title"><h2>${title} · ${count(uniqueStations)} postos</h2>${retryRoutes}</div><p class="muted">${count(selected.length)} abastecimentos afetados</p><div class="table-wrap"><table><thead><tr><th>Posto</th><th>Registros</th><th>Volume</th>${hasAction ? "<th>Ação</th>" : ""}</tr></thead><tbody>${
          [...stations.values()]
            .sort((a, b) => b.liters - a.liters)
            .slice(0, 50)
            .map(
              (row) =>
                `<tr><td>${esc(row.name)}<br><span class="muted">${esc(row.city)}/${esc(row.uf)} · ${esc(row.code)}</span></td><td>${count(row.records)}</td><td>${num(row.liters)} L</td>${hasAction ? `<td><button class="btn small secondary ${key === "station_match_review" ? "geoReviewStation" : "geoGeocodeTicketlog"}" data-code="${esc(row.code)}">${key === "station_match_review" ? "Revisar vínculo" : "Geocodificar"}</button></td>` : ""}</tr>`,
            )
            .join("") ||
          `<tr><td colspan="${hasAction ? 4 : 3}" class="muted">Nenhuma pendência.</td></tr>`
        }</tbody></table></div></div>`;
      })
      .join("")}</div>`;
  }

  function alternativesTab() {
    const rows = geo.data?.alternatives || [],
      directFuel = rows.filter((row) => row.source === "DirectFuel"),
      geocoded = directFuel.filter(
        (row) => numeric(row.lat) && numeric(row.lng),
      ).length,
      pending = directFuel.length - geocoded,
      bulkAction = geo.data?.canManage
        ? `<button class="btn secondary" id="geoGeocodeDirectFuel" ${geo.bulkDirectFuelGeocoding ? "disabled" : ""}>${geo.bulkDirectFuelGeocoding ? "Geocodificando..." : "Geocodificar DirectFuel em massa"}</button>`
        : "";
    return `<div class="panel"><div class="geo-detail-title"><div><h2>Georreferenciamento dos postos</h2><p class="muted">Esta tela não cria uma segunda rede. Nome, endereço e coordenadas vêm do Cadastro de Postos; aqui você acompanha a qualidade geográfica e executa a geocodificação em massa.</p><p class="note">DirectFuel: ${count(directFuel.length)} postos · ${count(geocoded)} georreferenciados · ${count(pending)} pendentes <span id="geoDirectFuelProgress"></span></p></div><div class="actions">${bulkAction}<button class="btn primary" id="geoOpenStations">Abrir Cadastro de Postos</button></div></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Origem</th><th>Posto</th><th>Município/UF</th><th>Produtos</th><th>Coordenadas</th><th>Situação</th><th>Ação</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(row.code || row.id)}</td><td>${esc(row.source)}</td><td><strong>${esc(row.name)}</strong><br><span class="muted">${esc(row.address)}</span></td><td>${esc(row.city)}/${esc(row.uf)}</td><td>${row.productIds?.map((id) => esc(produtoNome(id))).join(", ") || "Acordos vigentes"}</td><td>${numeric(row.lat) && numeric(row.lng) ? `${numeric(row.lat).toFixed(6)}, ${numeric(row.lng).toFixed(6)}` : "-"}</td><td>${numeric(row.lat) && numeric(row.lng) ? '<span class="badge ok">Georreferenciado</span>' : '<span class="badge warn">Pendente</span>'}</td><td>${row.source === "DirectFuel" ? '<button class="btn small secondary geoOpenStations">Editar no cadastro</button>' : `<button class="btn small secondary geoEditAlternative" data-id="${esc(row.id)}">Editar ponto externo</button>`}</td></tr>`).join("") || '<tr><td colspan="8" class="muted">Nenhum posto disponível no cadastro operacional.</td></tr>'}</tbody></table></div><p class="note">Geocodificação: Nominatim/OpenStreetMap. Rotas automáticas: OSRM/OpenStreetMap.</p></div>`;
  }

  function paramsTab() {
    const p = db.geoParams;
    return `<div class="panel"><h2>Parâmetros econômicos e rodoviários</h2><p class="note">O raio rodoviário máximo é a única regra de distância para classificar oportunidades. A distância considera somente a ida, e as rotas são calculadas automaticamente.</p><div class="geo-param-grid"><div class="field"><label>Raio rodoviário máximo (km)</label><input type="number" min="1" step=".1" id="gpRoadRadius" value="${numeric(p.maxRoadDistanceKm)}"></div><div class="field"><label>Alternativas por posto</label><input type="number" step="1" min="1" max="12" id="gpCandidates" value="${numeric(p.maxCandidates)}"></div><div class="field"><label>Diferença mínima por litro</label><input type="number" step=".01" id="gpPrice" value="${numeric(p.minPriceDiff)}"></div></div><div class="toolbar"><button class="btn primary" id="geoSaveParams">Salvar parâmetros</button></div></div>`;
  }

  function alternativeForm(item) {
    const stored =
        db.geoStations.find((row) => row.id === item?.id) || item || {},
      selectedProducts = new Set(stored.productIds || []),
      stationOptions = (db.postos || [])
        .map((row) =>
          option(
            row.id,
            `${row.codigo || row.id} · ${row.fantasia || row.razao}`,
            stored.operationalStationId || stored.operationalId || stored.postoId,
          ),
        )
        .join(""),
      productChecks = (db.produtos || [])
        .map(
          (row) =>
            `<label class="geo-check"><input type="checkbox" name="gaProduct" value="${esc(row.id)}" ${selectedProducts.has(row.id) ? "checked" : ""}> ${esc(row.curta || row.descricao)}</label>`,
        )
        .join("");
    modal(
      stored.id ? "Editar ponto geográfico" : "Novo ponto geográfico",
      `<div class="form-grid"><div class="field"><label>Origem</label><select id="gaSource">${["DirectFuel", "Parceiro", "Interno"].map((source) => option(source, source, stored.source || "DirectFuel")).join("")}</select></div><div class="field"><label>Vincular ao posto DirectFuel</label><select id="gaOperational">${option("", "Selecione", stored.operationalStationId || stored.operationalId || stored.postoId)}${stationOptions}</select></div><div class="field"><label>ID do ponto</label><input id="gaCode" value="${esc(stored.code || "")}"></div><div class="field"><label>Nome do posto</label><input id="gaName" value="${esc(stored.name || "")}"></div><div class="field span-2"><label>Endereço</label><input id="gaAddress" value="${esc(stored.address || "")}"></div><div class="field"><label>Cidade</label><input id="gaCity" value="${esc(stored.city || "")}"></div><div class="field"><label>UF</label><input id="gaUf" maxlength="2" value="${esc(stored.uf || "")}"></div><div class="field"><label>Latitude</label><input type="number" step=".000001" id="gaLat" value="${numeric(stored.lat) || ""}"></div><div class="field"><label>Longitude</label><input type="number" step=".000001" id="gaLng" value="${numeric(stored.lng) || ""}"></div><div class="field span-2"><label>Produtos atendidos</label><div class="geo-checks">${productChecks}</div></div><div class="field span-2"><button type="button" class="btn secondary" id="gaGeocode">Buscar coordenadas pelo endereço</button><span class="muted" id="gaGeoResult"></span></div></div>`,
      (dialog) => {
        const source = val("gaSource"),
          operationalStationId =
            source === "DirectFuel" ? val("gaOperational") : "",
          productIds = [
            ...document.querySelectorAll('input[name="gaProduct"]:checked'),
          ].map((input) => input.value),
          record = {
            id: stored.id || uid("GST"),
            code: val("gaCode") || uid("ALT"),
            source,
            operationalStationId,
            name: val("gaName"),
            address: val("gaAddress"),
            city: val("gaCity"),
            uf: val("gaUf").toUpperCase(),
            lat: nval("gaLat"),
            lng: nval("gaLng"),
            productIds,
            geoStatus:
              nval("gaLat") && nval("gaLng") ? "Georreferenciado" : "Pendente",
            status: "Ativo",
          };
        if (source === "DirectFuel" && !operationalStationId)
          return toast("Vincule o ponto a um posto do cadastro operacional");
        if (!record.name || !record.city || record.uf.length !== 2)
          return toast("Informe posto, cidade e UF");
        if (source === "DirectFuel") {
          const station = ent("postos", operationalStationId);
          if (station) {
            station.latitude = record.lat || "";
            station.longitude = record.lng || "";
            station.geocodeStatus =
              record.lat && record.lng ? "Georreferenciado" : "Pendente";
            station.geocodeUpdatedAt = new Date().toISOString();
            station.geocodeUpdatedBy =
              window.DIRECTFUEL_CURRENT_USER ||
              window.DIRECTFUEL_CURRENT_EMAIL ||
              "Usuário Vixpar";
          }
        }
        const index = db.geoStations.findIndex((row) => row.id === record.id);
        if (index >= 0) db.geoStations[index] = record;
        else db.geoStations.push(record);
        audit(
          stored.id ? "Alteração" : "Inclusão",
          "Ponto geográfico",
          `${record.code} · ${record.name}`,
        );
        save("Ponto geográfico salvo");
        dialog.remove();
        setTimeout(() => loadData(), 300);
      },
    );
    const fillStation = () => {
      if (val("gaSource") !== "DirectFuel") return;
      const station = ent("postos", val("gaOperational"));
      if (!station) return;
      $("#gaCode").value = station.codigo || station.id;
      $("#gaName").value = station.fantasia || station.razao || "";
      $("#gaAddress").value = [station.endereco, station.bairro, station.cep]
        .filter(Boolean)
        .join(", ");
      $("#gaCity").value = station.municipio || "";
      $("#gaUf").value = station.uf || "";
      $("#gaLat").value = numeric(station.latitude) || "";
      $("#gaLng").value = numeric(station.longitude) || "";
    };
    setTimeout(() => {
      $("#gaOperational").onchange = fillStation;
      $("#gaSource").onchange = fillStation;
      $("#gaGeocode").onclick = geocodeForm;
      if (!stored.id) fillStation();
    }, 0);
  }

  async function geocodeForm() {
    const address = [val("gaAddress"), val("gaCity"), val("gaUf"), "Brasil"]
        .filter(Boolean)
        .join(", "),
      button = $("#gaGeocode");
    button.disabled = true;
    button.textContent = "Buscando...";
    try {
      const response = await fetch("/api/geo-analysis", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "geocode", address }),
        }),
        payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Falha na geocodificação");
      const result = payload.results?.[0];
      if (!result)
        throw new Error(
          "Endereço não localizado. Complete o endereço ou informe as coordenadas.",
        );
      $("#gaLat").value = result.latitude;
      $("#gaLng").value = result.longitude;
      $("#gaGeoResult").textContent = `Localizado: ${result.label}`;
      toast("Coordenadas localizadas. Revise e salve o ponto.");
    } catch (error) {
      toast(error.message || "Não foi possível geocodificar");
    } finally {
      button.disabled = false;
      button.textContent = "Buscar coordenadas pelo endereço";
    }
  }

  async function geocodeTicketlogStation(button) {
    const stationCode = button.dataset.code;
    button.disabled = true;
    button.textContent = "Buscando...";
    try {
      const response = await fetch("/api/geo-analysis", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "geocode-ticketlog-station",
            stationCode,
          }),
        }),
        payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Falha na geocodificação");
      await loadData(`Posto ${stationCode} georreferenciado`);
    } catch (error) {
      toast(error.message || "Não foi possível geocodificar o posto");
      button.disabled = false;
      button.textContent = "Geocodificar";
    }
  }

  async function geocodeAllTicketlogStations() {
    if (geo.bulkGeocoding) return;
    if (!confirm("Geocodificar em massa todos os postos Ticketlog pendentes?\n\nAs coordenadas já existentes serão preservadas. Os resultados automáticos deverão ser revisados no mapa.")) return;
    geo.bulkGeocoding = true;
    renderPage();
    let processed = 0,
      geocoded = 0,
      notFound = 0,
      insufficient = 0,
      attempts = 0,
      lastRemaining = null;
    try {
      while (attempts < 80) {
        attempts++;
        const response = await fetch("/api/geo-analysis", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "geocode-ticketlog-batch", refresh: attempts === 1 }),
          }),
          payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Falha na geocodificação em massa");
        processed += numeric(payload.processed);
        geocoded += numeric(payload.geocoded);
        notFound += numeric(payload.notFound);
        insufficient += numeric(payload.insufficient);
        lastRemaining = numeric(payload.remaining);
        const progress = $("#geoBulkProgress");
        if (progress)
          progress.textContent = `${count(processed)} processados · ${count(geocoded)} georreferenciados · ${count(lastRemaining)} ainda na fila`;
        if (!payload.processed || !payload.remaining) break;
      }
      await loadData();
      alert(`Geocodificação concluída.\n\nProcessados: ${count(processed)}\nGeorreferenciados: ${count(geocoded)}\nNão localizados: ${count(notFound)}\nDados insuficientes: ${count(insufficient)}\nAinda pendentes: ${count(lastRemaining || 0)}\n\nRevise os pontos automáticos no mapa antes de utilizar a análise financeira.`);
    } catch (error) {
      toast(error.message || "Não foi possível concluir a geocodificação em massa");
    } finally {
      geo.bulkGeocoding = false;
      if (route === "analysis_geo") renderPage();
    }
  }

  async function geocodeAllDirectFuelStations() {
    if (geo.bulkDirectFuelGeocoding) return;
    const configured = new Map(
      (db.geoStations || [])
        .filter(
          (item) =>
            item.source === "DirectFuel" &&
            item.operationalStationId &&
            numeric(item.lat) &&
            numeric(item.lng),
        )
        .map((item) => [item.operationalStationId, item]),
    );
    for (const station of db.postos || []) {
      const point = configured.get(station.id);
      if (
        point &&
        (!numeric(station.latitude) || !numeric(station.longitude))
      ) {
        station.latitude = numeric(point.lat);
        station.longitude = numeric(point.lng);
        station.geocodeStatus = "Georreferenciado";
      }
    }
    const pending = (db.postos || []).filter(
      (station) =>
        station.status !== "Inativo" &&
        (!numeric(station.latitude) || !numeric(station.longitude)),
    );
    if (!pending.length) {
      save("Coordenadas DirectFuel sincronizadas");
      await new Promise((resolve) => setTimeout(resolve, 700));
      return loadData("Todos os postos DirectFuel já estão georreferenciados");
    }
    if (
      !confirm(
        `Geocodificar ${count(pending.length)} posto(s) DirectFuel pendente(s)?\n\nAs coordenadas existentes serão preservadas. Revise os pontos no mapa ao final.`,
      )
    )
      return;
    geo.bulkDirectFuelGeocoding = true;
    renderPage();
    let geocoded = 0,
      notFound = 0;
    const actor =
      window.DIRECTFUEL_CURRENT_USER ||
      window.DIRECTFUEL_CURRENT_EMAIL ||
      "Usuário Vixpar";
    try {
      for (let index = 0; index < pending.length; index++) {
        const station = pending[index],
          address = [
            station.fantasia || station.razao,
            station.endereco,
            station.bairro,
            station.municipio,
            station.uf,
            station.cep,
            "Brasil",
          ]
            .filter(Boolean)
            .join(", ");
        try {
          const response = await fetch("/api/geo-analysis", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "geocode", address }),
            }),
            payload = await response.json();
          if (!response.ok)
            throw new Error(payload.error || "Falha na geocodificação");
          const result = payload.results?.[0];
          if (result) {
            station.latitude = result.latitude;
            station.longitude = result.longitude;
            station.geocodeStatus = "Georreferenciado automático";
            geocoded++;
          } else {
            station.geocodeStatus = "Não localizado";
            notFound++;
          }
        } catch (error) {
          station.geocodeStatus = "Erro na geocodificação";
          notFound++;
        }
        station.geocodeUpdatedAt = new Date().toISOString();
        station.geocodeUpdatedBy = actor;
        const progress = $("#geoDirectFuelProgress");
        if (progress)
          progress.textContent = `· ${count(index + 1)}/${count(pending.length)} processados`;
        if (index < pending.length - 1)
          await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      audit(
        "Geocodificação em massa",
        "Postos DirectFuel",
        `${geocoded} georreferenciados; ${notFound} não localizados por ${actor}`,
      );
      save("Geocodificação DirectFuel concluída");
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await loadData();
      alert(
        `Geocodificação DirectFuel concluída.\n\nGeorreferenciados: ${count(geocoded)}\nNão localizados: ${count(notFound)}\n\nRevise os resultados no mapa.`,
      );
    } finally {
      geo.bulkDirectFuelGeocoding = false;
      if (route === "analysis_geo") renderPage();
    }
  }

  async function reprocessLinks() {
    const pending = numeric(geo.data?.summary?.pending_plate),
      records = numeric(geo.data?.summary?.records);
    if (
      !confirm(
        `Reprocessar os vínculos usando as placas atualmente cadastradas na Frota?\n\nPendentes: ${count(pending)}\nBase analisada: ${count(records)} abastecimentos`,
      )
    )
      return;
    const button = $("#geoReprocess");
    if (button) {
      button.disabled = true;
      button.textContent = "Reprocessando...";
    }
    try {
      const response = await fetch("/api/geo-analysis", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reprocess-links" }),
        }),
        payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Falha ao reprocessar");
      await loadData(
        `${count(payload.linked)} vinculados · ${count(payload.pending)} pendentes`,
      );
    } catch (error) {
      toast(error.message || "Não foi possível reprocessar os vínculos");
    }
  }
  function scheduleAutomaticRoutes() {
    const pending = numeric(geo.data?.summary?.route_pending),
      signature = `${queryString()}|${pending}`;
    if (
      !pending ||
      !geo.data?.canManage ||
      geo.routing ||
      geo.automaticRouteSignature === signature
    )
      return;
    geo.automaticRouteSignature = signature;
    setTimeout(() => calculateRoutes(), 0);
  }

  async function calculateRoutes(retryErrors = false) {
    if (geo.routing) return;
    geo.routing = true;
    let total = 0, calculated = 0, errors = 0;
    renderPage();
    try {
      while (true) {
        const response = await fetch("/api/geo-analysis", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "route-batch", retryErrors: retryErrors && total === 0 }),
          }),
          payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Falha no roteamento");
        total = payload.totalPairs || total;
        calculated += numeric(payload.calculated); errors += numeric(payload.errors);
        const progress = document.getElementById("geoCalculatePending") || document.getElementById("geoRetryRouteErrors");
        if (progress) progress.textContent = `${count(calculated)} calculadas · ${count(errors)} com erro · ${count(payload.remaining)} restantes`;
        if (!payload.remaining || !payload.processed) break;
      }
      await loadData(`${count(calculated)} rotas calculadas · ${count(errors)} com erro`);
    } catch (error) {
      toast(error.message || "Não foi possível calcular as rotas");
    } finally {
      geo.routing = false;
      if (route === "analysis_geo") renderPage();
    }
  }

  function exportExcel() {
    if (!geo.data) return;
    const cell = (value) =>
        `<Cell><Data ss:Type="String">${xml(value)}</Data></Cell>`,
      row = (values) => `<Row>${values.map(cell).join("")}</Row>`,
      sheets = [];
    const s = geo.data.summary || {};
    const d = geo.data.directFuelSummary || {};
    sheets.push([
      "Resumo",
      [
        ["Indicador", "Valor"],
        ["Abastecimentos", s.records],
        ["Volume", s.liters],
        ["Valor Ticketlog", s.value],
        ["Preço médio ponderado Ticketlog", s.liters ? numeric(s.value) / numeric(s.liters) : 0],
        ["Abastecimentos DirectFuel", d.records],
        ["Volume DirectFuel", d.liters],
        ["Valor DirectFuel", d.value],
        ["Preço médio ponderado DirectFuel", d.liters ? numeric(d.value) / numeric(d.liters) : 0],
        ["Postos DirectFuel", d.stations],
        ["DirectFuel sem coordenadas", d.pending_coordinates],
        ["Pendente de placa", s.pending_plate],
        ["Posto sem coordenadas", s.station_no_coordinates],
        ["Vínculo de posto para revisar", s.station_match_review],
        ["Com DirectFuel próximo", s.with_nearby_station],
        ["Rota pendente", s.route_pending],
        ["Alternativa fora do raio", s.outside_radius],
        ["Com acordo DirectFuel válido", s.with_valid_agreement],
        ["Oportunidades dentro do raio", s.opportunities],
        ["Litros com oportunidade", s.opportunity_liters],
        ["Saving bruto", s.gross_saving],
        ["Período", `${s.first_date} a ${s.last_date}`],
      ],
    ]);
    const groupNames = {
      stations: "Por posto",
      plates: "Por placa",
      units: "Por unidade",
      costCenters: "Por centro custo",
      periods: "Por período",
    };
    Object.entries(geo.data.groups || {}).forEach(([key, values]) =>
      sheets.push([
        groupNames[key] || key,
        [
          [
            "Grupo",
            "Abastecimentos",
            "Oportunidades",
            "Litros",
            "Valor Ticketlog",
            "Saving bruto",
          ],
          ...values.map((item) => [
            item.label,
            item.records,
            item.opportunities,
            item.liters,
            item.value,
            item.grossSaving,
          ]),
        ],
      ]),
    );
    sheets.push([
      "Abastecimentos",
      [
        [
          "Transação",
          "Data",
          "Placa",
          "Unidade",
          "Centro de custo",
          "Posto Ticketlog",
          "Produto Ticketlog",
          "Produto DirectFuel",
          "Compatibilidade do produto",
          "Litros",
          "Preço Ticketlog",
          "Alternativa DirectFuel",
          "Vínculo geográfico",
          "Preço DirectFuel",
          "Distância rodoviária de ida km",
          "Raio rodoviário máximo km",
          "Dentro do raio",
          "Saving bruto",
          "Classificação",
          "Situação",
          "Motivo da pendência de placa",
          "Ação recomendada",
        ],
        ...(geo.data.rows || []).map((item) => [
          item.transaction_code,
          item.occurred_on,
          item.plate,
          item.unit_name,
          item.cost_center,
          item.station_name,
          item.product,
          item.directfuel_product || "",
          item.product_match_label || "",
          item.liters,
          item.ticketlog_price || item.final_price,
          item.alternative_name || "",
          item.station_match_label || "",
          item.directfuel_price || "",
          item.road_distance_km ?? "",
          item.road_radius_km || db.geoParams.maxRoadDistanceKm,
          item.within_radius === true
            ? "Sim"
            : item.within_radius === false
              ? "Não"
              : "",
          item.gross_saving ?? "",
          item.opportunity_level || "",
          item.analysis_label,
          item.plate_pending_reason || "",
          item.plate_pending_action || "",
        ]),
      ],
    ]);
    sheets.push([
      "Abastecimentos DirectFuel",
      [
        [
          "Transação",
          "Data",
          "Placa",
          "Unidade",
          "Centro de custo",
          "Posto DirectFuel",
          "Produto",
          "Litros",
          "Preço DirectFuel",
          "Valor DirectFuel",
          "Latitude",
          "Longitude",
          "Situação",
        ],
        ...(geo.data.directFuelRows || []).map((item) => [
          item.transaction_code,
          item.occurred_on,
          item.plate,
          item.unit_name,
          item.cost_center,
          item.station_name,
          item.product,
          item.liters,
          item.final_price,
          item.final_value,
          item.latitude || "",
          item.longitude || "",
          item.analysis_label,
        ]),
      ],
    ]);
    const body = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.map(([name, rows]) => `<Worksheet ss:Name="${xml(String(name).slice(0, 31))}"><Table>${rows.map(row).join("")}</Table></Worksheet>`).join("")}</Workbook>`;
    downloadFile(
      `analise_geografica_${new Date().toISOString().slice(0, 10)}.xls`,
      `\ufeff${body}`,
      "application/vnd.ms-excel",
    );
  }
  function exportGeo(kind) {
    const stations = stationPoints(),
      alternatives = geo.data?.alternatives || [],
      points = [
        ...stations.map((row) => ({ ...row, category: row.source })),
        ...alternatives
          .filter((row) => numeric(row.lat) && numeric(row.lng))
          .map((row) => ({
            code: row.code,
            name: row.name,
            city: row.city,
            uf: row.uf,
            lat: row.lat,
            lng: row.lng,
            category: row.source,
            liters: 0,
            records: 0,
          })),
      ];
    if (!points.length)
      return toast("Não há pontos georreferenciados para exportar");
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "geojson")
      return downloadFile(
        `analise_geografica_${stamp}.geojson`,
        JSON.stringify(
          {
            type: "FeatureCollection",
            features: points.map((row) => ({
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [numeric(row.lng), numeric(row.lat)],
              },
              properties: {
                codigo: row.code,
                posto: row.name,
                origem: row.category,
                cidade: row.city,
                uf: row.uf,
                abastecimentos: row.records,
                volume_litros: row.liters,
              },
            })),
          },
          null,
          2,
        ),
        "application/geo+json",
      );
    downloadFile(
      `analise_geografica_${stamp}.kml`,
      `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${points.map((row) => `<Placemark><name>${xml(row.name)}</name><description>${xml(`${row.category} · ${num(row.liters)} L`)}</description><Point><coordinates>${numeric(row.lng)},${numeric(row.lat)},0</coordinates></Point></Placemark>`).join("")}</Document></kml>`,
      "application/vnd.google-earth.kml+xml",
    );
  }
  function mapSvg() {
    const points = mapPoints();
    if (!points.length)
      return '<div style="padding:20px;font-size:10px">Sem pontos georreferenciados na seleção.</div>';
    const lats = points.map((row) => numeric(row.lat)),
      lngs = points.map((row) => numeric(row.lng)),
      minLat = Math.min(...lats),
      maxLat = Math.max(...lats),
      minLng = Math.min(...lngs),
      maxLng = Math.max(...lngs),
      latRange = Math.max(0.01, maxLat - minLat),
      lngRange = Math.max(0.01, maxLng - minLng),
      colors = {
        Ticketlog: "#2563eb",
        DirectFuel: "#0f8b68",
        Parceiro: "#e58b3a",
        Interno: "#7f56d9",
      };
    return `<svg viewBox="0 0 720 420" role="img" aria-label="Mapa esquemático dos abastecimentos"><rect width="720" height="420" fill="#eef4f2"/><path d="M0 80H720M0 160H720M0 240H720M0 320H720M120 0V420M240 0V420M360 0V420M480 0V420M600 0V420" stroke="#d9e4e1" stroke-width="1"/>${points
      .map((row) => {
        const x = 30 + ((numeric(row.lng) - minLng) / lngRange) * 660,
          y = 390 - ((numeric(row.lat) - minLat) / latRange) * 360,
          radius = row.alternative ? 5 : 7;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" fill="${colors[row.source] || "#667085"}" stroke="#fff" stroke-width="2"><title>${xml(`${row.source} · ${row.name} · ${num(row.liters)} L`)}</title></circle>`;
      })
      .join("")}<g font-family="Arial" font-size="10" fill="#344054"><rect x="12" y="12" width="315" height="27" rx="6" fill="#fff" opacity=".92"/><circle cx="28" cy="25" r="5" fill="#2563eb"/><text x="38" y="29">Ticketlog</text><circle cx="105" cy="25" r="5" fill="#0f8b68"/><text x="115" y="29">DirectFuel</text><circle cx="196" cy="25" r="5" fill="#e58b3a"/><text x="206" y="29">Parceiro</text><circle cx="265" cy="25" r="5" fill="#7f56d9"/><text x="275" y="29">Interno</text></g></svg>`;
  }
  function exportPdf() {
    const s = geo.data?.summary || {},
      d = geo.data?.directFuelSummary || {},
      tops = topOpportunities(),
      report = window.open("", "_blank");
    if (!report) return toast("Permita a abertura de janelas para gerar o PDF");
    report.document.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Análise geográfica</title><style>@page{size:A4 landscape;margin:7mm}*{box-sizing:border-box}body{font-family:Arial;margin:0;color:#17212b;-webkit-print-color-adjust:exact;print-color-adjust:exact}.head{background:#10231f;color:#fff;padding:10px 14px;border-radius:9px;display:flex;justify-content:space-between}.head h1{margin:0;font-size:20px}.head p{margin:4px 0 0;font-size:10px}.head img{height:30px;background:#fff;padding:3px;border-radius:5px}.cards{display:grid;grid-template-columns:repeat(8,1fr);gap:5px;margin:8px 0}.card{border:1px solid #dfe6e4;border-radius:7px;padding:7px}.card.hero{background:#0f7b5d;color:#fff}.card span,.card small{display:block;font-size:7px}.card b{display:block;font-size:13px;margin:4px 0}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:8px}.map{height:120mm;border:1px solid #dfe6e4;border-radius:8px;overflow:hidden}.map svg{width:100%;height:100%}.box{border:1px solid #dfe6e4;border-radius:8px;padding:8px}.box h2{font-size:11px;margin:0 0 5px}.row{display:grid;grid-template-columns:1fr 75px;gap:5px;font-size:7px;padding:4px 0;border-bottom:1px solid #edf0ef}.foot{text-align:right;font-size:7px;color:#667085;margin-top:4px}</style></head><body><header class="head"><div><h1>Análise geográfica e fuga DirectFuel</h1><p>Período analisado: ${dateBR(s.first_date)} a ${dateBR(s.last_date)} · dados reais DirectFuel e Ticketlog</p></div><img src="${location.origin}/logo-vixpar.png"></header><section class="cards">${[
        ["Abastecimentos", count(s.records)],
        ["DirectFuel", count(d.records)],
        ["Volume DirectFuel", `${num(d.liters)} L`],
        ["Pend. placa", count(s.pending_plate)],
        ["Sem coordenadas", count(s.station_no_coordinates)],
        ["Oportunidades", count(s.opportunities)],
        ["Saving bruto", money(s.gross_saving)],
        ["Litros oportunidade", `${num(s.opportunity_liters)} L`],
      ]
        .map(
          (item, index) =>
            `<div class="card ${index === 0 || index === 7 ? "hero" : ""}"><span>${item[0]}</span><b>${item[1]}</b><small>Seleção atual</small></div>`,
        )
        .join(
          "",
        )}</section><div class="grid"><div class="map">${mapSvg()}</div><div class="box"><h2>10 maiores oportunidades</h2>${tops.map((row, index) => `<div class="row"><span>${index + 1}. ${esc(row.label)}</span><b>${money(row.grossSaving)}</b></div>`).join("") || '<p style="font-size:8px">Nenhuma oportunidade calculada.</p>'}<h2 style="margin-top:10px">Critérios</h2><div class="row"><span>Preço</span><b>Acordo válido na data</b></div><div class="row"><span>Produto</span><b>Idêntico ou S-10 compatível</b></div><div class="row"><span>Distância</span><b>Rodoviária de ida automática</b></div><div class="row"><span>Raio máximo</span><b>${num(db.geoParams.maxRoadDistanceKm)} km</b></div><div class="row"><span>Mesma rodovia</span><b>Análise opcional</b></div></div></div><div class="foot">DirectFuel Vixpar · Sistema v56 · OSRM/OpenStreetMap · Gerado em ${new Date().toLocaleString("pt-BR")}</div><script>setTimeout(()=>print(),500)<\/script></body></html>`,
    );
    report.document.close();
  }

  function tabsHtml() {
    return `<div class="geo-tabs">${[
      ["overview", "Visão executiva"],
      ["fuelings", "Abastecimentos"],
      ["consolidated", "Consolidações"],
      ["pending", "Pendências"],
      ["alternatives", "Georreferenciamento"],
      ["params", "Parâmetros"],
    ]
      .map(
        ([key, label]) =>
          `<button class="geo-tab ${geo.tab === key ? "active" : ""}" data-geotab="${key}">${label}</button>`,
      )
      .join("")}</div>`;
  }
  function renderPage() {
    ensureParams();
    pageTitle(
      "Análise geográfica",
      "Fuga, alternativas e saving com abastecimentos reais",
    );
    if (!geo.data && !geo.loading && !geo.error) {
      $("#view").innerHTML =
        '<div class="panel"><p class="muted">Integrando os abastecimentos Ticketlog...</p></div>';
      loadData();
      return;
    }
    const content =
      geo.loading && !geo.data
        ? '<div class="panel"><p class="muted">Calculando indicadores e vínculos...</p></div>'
        : geo.error
          ? `<div class="panel"><h2>Não foi possível carregar</h2><p class="note">${esc(geo.error)}</p><button class="btn primary" id="geoRetry">Tentar novamente</button></div>`
          : geo.tab === "overview"
            ? overviewTab()
            : geo.tab === "fuelings"
              ? fuelingsTab()
              : geo.tab === "consolidated"
                ? consolidatedTab()
                : geo.tab === "pending"
                  ? pendingTab()
                  : geo.tab === "alternatives"
                    ? alternativesTab()
                    : paramsTab();
    if (geo.leafletMap) {
      geo.leafletMap.remove();
      geo.leafletMap = null;
    }
    $("#view").innerHTML =
      `${geo.data ? filtersHtml() : ""}${tabsHtml()}${geo.routing ? '<div class="panel geo-processing"><strong>Calculando rotas rodoviárias reais...</strong><span>O processo continua em lotes seguros e grava cada resultado.</span></div>' : ""}${content}`;
    bind();
    if (geo.data && geo.tab === "overview") setTimeout(() => initLeafletMap(), 0);
    window.directFuelAddScreenExport?.();
  }
  function bind() {
    $$(".geo-tab").forEach(
      (button) =>
        (button.onclick = () => {
          const nextTab = button.dataset.geotab;
          const clearOpportunity =
            geo.tab === "fuelings" &&
            nextTab !== "fuelings" &&
            geo.filters.opportunity;
          geo.tab = nextTab;
          if (clearOpportunity) {
            geo.filters.opportunity = "";
            loadData();
          } else renderPage();
        }),
    );
    $$("[data-geogroup]").forEach(
      (button) =>
        (button.onclick = () => {
          geo.group = button.dataset.geogroup;
          renderPage();
        }),
    );
    if ($("#geoRetry")) $("#geoRetry").onclick = () => loadData();
    const updateProductSummary=()=>{const count=document.querySelectorAll('input[name="geoProductChoice"]:checked').length;if($('#geoProductSummary'))$('#geoProductSummary').textContent=count?`${count} produto(s) selecionado(s)`:'Todos os produtos';};
    $$('input[name="geoProductChoice"]').forEach(input=>input.onchange=updateProductSummary);
    if($('#geoAllProducts'))$('#geoAllProducts').onclick=()=>{$$('input[name="geoProductChoice"]').forEach(input=>input.checked=false);updateProductSummary();};
    if ($("#geoApply"))
      $("#geoApply").onclick = () => {
        geo.filters = {
          from: val("geoFrom"),
          to: val("geoTo"),
          uf: val("geoUf"),
          product: Array.from(document.querySelectorAll('input[name="geoProductChoice"]:checked'),input=>input.value),
          status: val("geoStatus"),
          station: val("geoStation"),
          origin: val("geoOrigin"),
          opportunity: $("#geoOpportunity")
            ? val("geoOpportunity")
            : "",
          minLiters: val("geoMinLiters"),
          maxLiters: val("geoMaxLiters"),
        };
        loadData();
      };
    if ($("#geoClear"))
      $("#geoClear").onclick = () => {
        geo.filters = {
          from: "",
          to: "",
          uf: "",
          product: [],
          status: "",
          station: "",
          origin: "",
          opportunity: "",
          minLiters: "",
          maxLiters: "",
        };
        loadData();
      };
    if ($("#geoRefresh"))
      $("#geoRefresh").onclick = () => loadData("Análise atualizada");
    $$(".geoReviewStation").forEach(button => { button.onclick = () => reviewStation(button.dataset.code); });
    if ($("#geoReprocess")) $("#geoReprocess").onclick = reprocessLinks;
    if ($("#geoReprocessPending")) $("#geoReprocessPending").onclick = reprocessLinks;
    if ($("#geoCalculatePending")) $("#geoCalculatePending").onclick = () => calculateRoutes();
    if ($("#geoRetryRouteErrors")) $("#geoRetryRouteErrors").onclick = () => calculateRoutes(true);
    if ($("#geoOpenFleetPending")) $("#geoOpenFleetPending").onclick = () => { route = "frota"; render(); };
    if ($("#geoFullscreen")) $("#geoFullscreen").onclick = toggleMapFullscreen;
    $$("[data-geo-pending]").forEach((card) => {
      const open = () => {
        geo.tab = "pending";
        geo.filters.status = card.dataset.geoPending;
        loadData();
      };
      card.onclick = open;
      card.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") open();
      };
    });
    $$("[data-geomode]").forEach(
      (button) =>
        (button.onclick = () => {
          geo.mapMode = button.dataset.geomode;
          $$("[data-geomode]").forEach((item) =>
            item.classList.toggle("active", item.dataset.geomode === geo.mapMode),
          );
          initLeafletMap();
        }),
    );
    if ($("#geoHeatmap"))
      $("#geoHeatmap").onclick = () => {
        geo.heatmap = !geo.heatmap;
        $("#geoHeatmap").classList.toggle("active", geo.heatmap);
        initLeafletMap();
      };
    if ($("#geoExcel")) $("#geoExcel").onclick = exportExcel;
    if ($("#geoPdf")) $("#geoPdf").onclick = exportPdf;
    if ($("#geoJson")) $("#geoJson").onclick = () => exportGeo("geojson");
    if ($("#geoKml")) $("#geoKml").onclick = () => exportGeo("kml");
    $$(".geoOpenStations").forEach(
      (button) =>
        (button.onclick = () => {
          route = "postos";
          render();
        }),
    );
    if ($("#geoOpenStations"))
      $("#geoOpenStations").onclick = () => {
        route = "postos";
        render();
      };
    $$(".geoEditAlternative").forEach(
      (button) =>
        (button.onclick = () =>
          alternativeForm(
            (geo.data?.alternatives || []).find(
              (row) => row.id === button.dataset.id,
            ),
          )),
    );
    $$(".geoDeleteAlternative").forEach(
      (button) =>
        (button.onclick = () => {
          const row = db.geoStations.find(
            (item) => item.id === button.dataset.id,
          );
          if (row && confirm(`Excluir o ponto ${row.name}?`)) {
            db.geoStations = db.geoStations.filter(
              (item) => item.id !== row.id,
            );
            audit("Exclusão", "Ponto geográfico", row.code || row.id);
            save("Ponto geográfico excluído");
            setTimeout(() => loadData(), 300);
          }
        }),
    );
    $$(".geoGeocodeTicketlog").forEach(
      (button) => (button.onclick = () => geocodeTicketlogStation(button)),
    );
    if ($("#geoGeocodeAll"))
      $("#geoGeocodeAll").onclick = geocodeAllTicketlogStations;
    if ($("#geoGeocodeDirectFuel"))
      $("#geoGeocodeDirectFuel").onclick = geocodeAllDirectFuelStations;
    if ($("#geoSaveParams"))
      $("#geoSaveParams").onclick = () => {
        Object.assign(db.geoParams, {
          maxRoadDistanceKm: Math.max(1, nval("gpRoadRadius")),
          maxCandidates: Math.max(1, Math.min(12, nval("gpCandidates"))),
          minPriceDiff: nval("gpPrice"),
        });
        delete db.geoParams.searchRadiusKm;
        delete db.geoParams.minSaving;
        delete db.geoParams.roadCostKm;
        delete db.geoParams.confirmedKm;
        delete db.geoParams.probableKm;
        audit(
          "Alteração",
          "Parâmetros geográficos",
          "Critérios econômicos e rodoviários",
        );
        save("Parâmetros geográficos salvos");
      };
  }
  let group = navGroups.find(([label]) => label === "ANÁLISES");
  if (!group) {
    group = ["ANÁLISES", []];
    const managementIndex = navGroups.findIndex(([label]) => label === "GESTÃO");
    navGroups.splice(
      managementIndex >= 0 ? managementIndex : navGroups.length,
      0,
      group,
    );
  }
  if (!group[1].some(([key]) => key === "analysis_geo"))
    group[1].push(["analysis_geo", "Análise geográfica", "dashboard"]);
  const previousRender = render;
  document.addEventListener("fullscreenchange", () => {
    const button = $("#geoFullscreen");
    if (button)
      button.textContent = document.fullscreenElement
        ? "Sair da tela cheia"
        : "Tela cheia";
    setTimeout(() => geo.leafletMap?.invalidateSize(), 120);
  });
  render = function () {
    if (route === "analysis_geo") {
      renderNav();
      renderPage();
      return;
    }
    previousRender();
  };
  render();
})();
