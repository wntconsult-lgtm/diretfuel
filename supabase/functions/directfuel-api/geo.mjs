import {active,list,clean,numeric,plate,isoDate,validCoordinates,filters,operationalMaps,alternatives,analyzeRows,directFuelRows,groupRows,filterByStationVolume,isOpportunityWithinRadius} from './core/directfuel-geo-core.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function readGeo(state,url){
 const selected=filters(url);
 if(selected.from&&selected.to&&selected.from>selected.to)throw fail('A data inicial deve ser anterior à data final.');
 if(selected.maxLiters&&selected.minLiters>selected.maxLiters)throw fail('Volume mínimo deve ser menor que o máximo.');
 const ticket=state.ticketlogFuelings||[],stations=new Map((state.ticketlogStations||[]).map(s=>[s.source_code,s]));
 const fuelings={results:ticket.filter(r=>selected.origin!=='DirectFuel'&&(!selected.from||r.occurred_on>=selected.from)&&(!selected.to||r.occurred_on<=selected.to)&&(!selected.uf||r.uf===selected.uf)&&(!selected.products.length||selected.products.includes(r.product))&&(!selected.station||r.station_code===selected.station)).sort((a,b)=>String(b.occurred_on).localeCompare(String(a.occurred_on))||String(b.transaction_code).localeCompare(String(a.transaction_code))).slice(0,20000).map(r=>{const s=stations.get(r.station_code)||{};return {...r,cnpj:s.cnpj,address:s.address,latitude:s.latitude,longitude:s.longitude,geocode_status:s.geocode_status};})};
 const routeResult={results:[]}; // No road distance is inferred from straight-line distance.
 const products={results:[...new Set(ticket.map(r=>r.product).filter(Boolean))].sort().map(product=>({product}))},ufs={results:[...new Set(ticket.map(r=>r.uf).filter(Boolean))].sort().map(uf=>({uf}))},stationMap=new Map();
 for(const r of ticket)if(!stationMap.has(r.station_code))stationMap.set(r.station_code,{station_code:r.station_code,station_name:r.station_name,city:r.city,uf:r.uf});
 const stationOptions={results:[...stationMap.values()].sort((a,b)=>String(a.station_name).localeCompare(String(b.station_name)))};
    let rows = analyzeRows(
      fuelings.results            ,
      state,
      routeResult.results            ,
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
    const count = (status        ) =>
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
    return (
      {
        canManage:
          true,
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
            ...(stationOptions.results            ).map((item) => ({
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
      }
    );

}
export async function reviewGeo({state,body,email,persist}){
 if(body.action!=='review-station')throw fail('Rotas e busca de coordenadas aguardam um provedor compatível. Informe coordenadas no cadastro ou na carga Ticketlog.',503);
 const code=clean(body.stationCode,80),mode=clean(body.mode),targetId=clean(body.targetId,120),reason=clean(body.reason,1000);
 if(!['same','different','automatic'].includes(mode)||!code||!reason)throw fail('Informe a decisão e a justificativa.');
 if(!(state.ticketlogStations||[]).some(s=>s.source_code===code))throw fail('Posto Ticketlog não encontrado.',404);
 if(mode==='same'&&!(state.postos||[]).some(s=>s.id===targetId))throw fail('Selecione um posto DirectFuel válido.');
 const old=(state.stationReviews||[]).find(s=>s.stationCode===code);
 if((old?.reviewedAt||null)!==(body.reviewedAt||null))throw fail('O vínculo foi revisado. Atualize a análise antes de salvar.',409);
 const next=structuredClone(state);next.stationReviews=(next.stationReviews||[]).filter(s=>s.stationCode!==code);
 if(mode!=='automatic')next.stationReviews.push({id:old?.id||crypto.randomUUID(),stationCode:code,mode,targetId:mode==='same'?targetId:'',reason,reviewedAt:new Date(Math.max(Date.now(),Date.parse(old?.reviewedAt||'')+1||0)).toISOString(),reviewedBy:email});
 await persist(next);return {ok:true};
}
