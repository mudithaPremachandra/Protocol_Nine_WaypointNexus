import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { ago, hhmm } from '../../lib/format';
import { DEPOTS, DISTRICTS, inServiceArea, outletPosition, type LatLng } from '../../lib/geo';

export interface MapTrip {
  id: string;
  vehicleId: string;
  tripNo: number;
  district: string;
  depot: string;
  status: string;
  maxLateRisk: number;
  /** Phone GPS fixes, newest first. */
  trail?: { lat: number; lng: number; at: string; accuracy: number | null }[];
  stops: { seq: number; outletId: string; outletName: string; orderNo: string; status: string; plannedArrival: number | null; lateRisk: number | null }[];
}

// Late risk uses the darker warning tone: it stands out against the map's own yellows and oranges.
const C = { tea: '#1F6F5C', mari: '#F0A202', crit: '#B0302A', risk: '#A4500F', ink: '#16302B', line: '#7D8D88' };

/** Map layers the legend can hide. Route styles (late risk, selected) are not layers. */
export type MapLayer = 'depot' | 'vehicles' | 'pending' | 'delivered' | 'failed' | 'driven' | 'toCome';

const depotIcon = (label: string) =>
  L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;gap:6px;white-space:nowrap;width:max-content"><span style="flex:none;width:22px;height:22px;box-sizing:border-box;border-radius:5px;background:${C.ink};display:block;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)"></span><b style="font:700 12px Atkinson Hyperlegible,sans-serif;color:${C.ink};text-shadow:0 0 3px #fff,0 0 3px #fff">${label}</b></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

const vehicleIcon = (label: string, tone: string) =>
  L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;gap:6px;white-space:nowrap;width:max-content"><span style="flex:none;width:18px;height:18px;box-sizing:border-box;border-radius:50%;background:${tone};border:3px solid ${C.ink};box-shadow:0 0 0 2px #fff,0 1px 4px rgba(0,0,0,.35);display:block"></span><b style="font:700 12px Atkinson Hyperlegible,sans-serif;color:${C.ink};text-shadow:0 0 3px #fff,0 0 3px #fff">${label}</b></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

/**
 * Cooperative zoom: a trackpad pinch (which browsers send as Ctrl + wheel) or Ctrl/Cmd + scroll zooms
 * the map, while a plain scroll keeps scrolling the page. Without this, a pinch over the map zooms the
 * whole page, because the map otherwise ignores wheel events.
 */
function CooperativeZoom() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const parent = el.parentElement;
    if (!parent) return;
    // Capture phase on the parent runs before Leaflet's own wheel handler on the container.
    const onWheel = (e: WheelEvent) => {
      if (!(el === e.target || el.contains(e.target as Node))) return;
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); // plain scroll: let the page scroll
    };
    parent.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => parent.removeEventListener('wheel', onWheel, { capture: true });
  }, [map]);
  return null;
}

/** Fits the whole depot's routes, or zooms to the selected trip; clicking it again zooms back out. */
function FitView({ all, focus }: { all: LatLng[]; focus: LatLng[] | null }) {
  const map = useMap();
  const allKey = all.map((p) => p.join(',')).join('|');
  const focusKey = focus?.map((p) => p.join(',')).join('|') ?? '';
  useEffect(() => {
    const pts = focus ?? all;
    if (pts.length) map.flyToBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: focus ? 13 : 11, duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allKey, focusKey, map]);
  return null;
}

/**
 * Live map (D5). Filled circles are recorded stops, white ones still to come. Solid lines are legs
 * driven, dashed lines the remaining route. A vehicle is drawn where the driver's phone last reported
 * it (recent fixes inside Sri Lanka only), with its GPS trail; otherwise at its last recorded stop.
 * Either way the tooltip says how old the position is.
 */
export function LiveMap({ depot, trips, selected, onSelect, hidden = new Set() }: { depot: string; trips: MapTrip[]; selected: string | null; onSelect: (id: string) => void; hidden?: ReadonlySet<MapLayer> }) {
  const show = (l: MapLayer) => !hidden.has(l);
  const depotPos = DEPOTS[depot]!;
  const routes = useMemo(
    () =>
      trips.map((t) => {
        const points = t.stops.map((s) => ({ ...s, pos: outletPosition(s.outletId, t.district, s.outletName) }));
        const doneIdx = points.reduce((last, s, i) => (s.status !== 'pending' ? i : last), -1);
        return { t, points, doneIdx };
      }),
    [trips],
  );
  const bounds: LatLng[] = [depotPos, ...routes.flatMap((r) => r.points.map((p) => p.pos))];
  const sel = routes.find((r) => r.t.id === selected);
  const focus: LatLng[] | null = sel ? [depotPos, ...sel.points.map((p) => p.pos)] : null;

  return (
    <MapContainer center={depotPos} zoom={9} scrollWheelZoom style={{ height: 420, borderRadius: 12, zIndex: 0 }} aria-label={`Map of ${depot} trips`}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitView all={bounds} focus={focus} />
      <CooperativeZoom />
      {routes.map(({ t, points, doneIdx }) => {
        const isSel = selected === t.id;
        const faded = !!selected && !isSel;
        const risky = t.maxLateRisk >= 0.5 && t.status !== 'completed';
        const color = isSel ? C.mari : t.status === 'completed' ? C.tea : risky ? C.risk : C.line;
        const all: LatLng[] = [depotPos, ...points.map((p) => p.pos)];
        const driven = t.status === 'in_progress' || t.status === 'completed' ? all.slice(0, doneIdx + 2) : [];
        const remaining = all.slice(Math.max(0, driven.length - 1));
        const fixes = (t.trail ?? []).filter((p) => inServiceArea(p.lat, p.lng));
        const fresh = fixes[0] && Date.now() - new Date(fixes[0].at).getTime() < 30 * 60_000 ? fixes[0] : null;
        const stopPos = doneIdx >= 0 ? points[doneIdx]!.pos : depotPos;
        const here: LatLng | null = t.status === 'in_progress' ? (fresh ? [fresh.lat, fresh.lng] : stopPos) : null;
        const hereText = fresh
          ? `phone location ${ago(fresh.at)}${fresh.accuracy ? ` (±${fresh.accuracy} m)` : ''}`
          : `last recorded ${doneIdx >= 0 ? `at stop ${doneIdx + 1}` : 'leaving the depot'}`;
        return (
          <span key={t.id}>
            {show('driven') && driven.length > 1 && <Polyline positions={driven} pathOptions={{ color: C.tea, weight: isSel ? 6 : 3, opacity: faded ? 0.25 : 0.9 }} eventHandlers={{ click: () => onSelect(t.id) }} />}
            {show('toCome') && remaining.length > 1 && t.status !== 'completed' && (
              <Polyline positions={remaining} pathOptions={{ color, weight: isSel ? 6 : 3, dashArray: isSel ? '4 8' : '2 8', opacity: faded ? 0.25 : isSel || risky ? 1 : 0.7 }} eventHandlers={{ click: () => onSelect(t.id) }} />
            )}
            {points
              .filter((p) => show(p.status === 'pending' ? 'pending' : p.status === 'failed' ? 'failed' : 'delivered'))
              .map((p) => (
              <CircleMarker
                key={`${t.id}-${p.seq}`}
                center={p.pos}
                radius={p.orderNo === 'WF-30921' ? 8 : 6}
                pathOptions={{
                  color: p.status === 'failed' ? C.crit : p.orderNo === 'WF-30921' ? C.mari : C.tea,
                  weight: 2.5,
                  fillColor: p.status === 'pending' ? '#fff' : p.status === 'failed' ? C.crit : C.tea,
                  fillOpacity: faded ? 0.3 : 1,
                  opacity: faded ? 0.3 : 1,
                }}
                eventHandlers={{ click: () => onSelect(t.id) }}
              >
                <Tooltip>
                  <b>{p.outletName}</b>
                  <br />
                  {p.orderNo}, {t.vehicleId} stop {p.seq + 1}
                  <br />
                  {p.status === 'pending' ? `Planned ${hhmm(p.plannedArrival)}${p.lateRisk && p.lateRisk >= 0.5 ? `, late risk ${Math.round(p.lateRisk * 100)}%` : ''}` : p.status}
                </Tooltip>
              </CircleMarker>
            ))}
            {show('vehicles') && fixes.length > 1 && <Polyline positions={fixes.map((p) => [p.lat, p.lng] as LatLng)} pathOptions={{ color: C.mari, weight: 2, opacity: 0.6 }} />}
            {show('vehicles') && here && (
              <Marker position={here} icon={vehicleIcon(t.vehicleId, risky ? C.risk : C.mari)} eventHandlers={{ click: () => onSelect(t.id) }}>
                <Tooltip>
                  {t.vehicleId}: {hereText}
                </Tooltip>
              </Marker>
            )}
          </span>
        );
      })}
      {show('depot') && <Marker position={depotPos} icon={depotIcon(`${depot} depot`)} />}
      {Object.entries(DISTRICTS)
        .filter(([d]) => trips.some((t) => t.district === d))
        .map(([d, pos]) => (
          <CircleMarker key={d} center={pos} radius={0} pathOptions={{ opacity: 0 }}>
            <Tooltip permanent direction="top" offset={[0, -14]} className="district-label">
              {d}
            </Tooltip>
          </CircleMarker>
        ))}
    </MapContainer>
  );
}

/**
 * Interactive legend: each layer is a toggle button (click to hide or show it on the map; hidden
 * items are struck through). Late risk and selected trip are route styles, so they are a plain key.
 */
export function MapLegend({ hidden, onToggle, onShowAll }: { hidden: ReadonlySet<MapLayer>; onToggle: (l: MapLayer) => void; onShowAll: () => void }) {
  const circle = (fill: string, stroke: string) => (
    <span aria-hidden="true" style={{ flex: 'none', width: 12, height: 12, borderRadius: '50%', background: fill, border: `2.5px solid ${stroke}`, display: 'inline-block', boxSizing: 'border-box' }} />
  );
  const line = (color: string, dashed: boolean) => (
    <span aria-hidden="true" style={{ flex: 'none', width: 22, height: 0, borderTop: `3px ${dashed ? 'dotted' : 'solid'} ${color}`, display: 'inline-block' }} />
  );
  const toggles: [MapLayer, React.ReactNode, string][] = [
    ['depot', <span aria-hidden="true" style={{ flex: 'none', width: 12, height: 12, borderRadius: 3, background: C.ink, display: 'inline-block' }} />, 'Depot'],
    ['vehicles', circle(C.mari, C.ink), 'Vehicles'],
    ['pending', circle('#fff', C.tea), 'Outlets to deliver'],
    ['delivered', circle(C.tea, C.tea), 'Delivered'],
    ['failed', circle(C.crit, C.crit), 'Failed'],
    ['driven', line(C.tea, false), 'Route driven'],
    ['toCome', line(C.line, true), 'Route to come'],
  ];
  return (
    <div className="small muted" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div role="group" aria-label="Map layers" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {toggles.map(([key, swatch, label]) => {
          const on = !hidden.has(key);
          return (
            <button key={key} type="button" className="legend-btn" aria-pressed={on} title={on ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} onClick={() => onToggle(key)}>
              <span style={{ opacity: on ? 1 : 0.35, display: 'inline-flex' }}>{swatch}</span>
              <span style={{ textDecoration: on ? 'none' : 'line-through' }}>{label}</span>
            </button>
          );
        })}
        {hidden.size > 0 && (
          <button type="button" className="link" onClick={onShowAll} style={{ marginLeft: 6 }}>
            Show all
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{line(C.risk, true)} Late risk</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{line(C.mari, true)} Selected trip</span>
        <span>Click a layer to hide it; click a trip to zoom to its route. Vehicles show the driver’s phone GPS, or the last recorded stop.</span>
      </div>
    </div>
  );
}
