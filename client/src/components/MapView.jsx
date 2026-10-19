import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const COLORS = { LIVE: '#059669', NO_SIGNAL: '#d97706', OFF: '#64748b' };
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pin(m, selected) {
  const color = COLORS[m.status] || COLORS.OFF;
  const size = selected ? 40 : 34;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);color:#fff;font:700 15px system-ui;display:flex;align-items:center;justify-content:center">${esc((m.label || '?').trim().charAt(0).toUpperCase())}</div>`,
  });
}

/** OpenStreetMap map. markers: [{id, lat, lng, label, status, popup}], trail: [{lat, lng}], selectedId */
export default function MapView({ markers, trail = [], selectedId, className = 'h-[60vh]' }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    const map = L.map(elRef.current, { zoomControl: true }).setView([22.9, 79.6], 5); // India
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds = [];
    if (trail.length > 1) {
      const pts = trail.map((p) => [p.lat, p.lng]);
      L.polyline(pts, { color: '#0f766e', weight: 4, opacity: 0.8 }).addTo(layer);
      bounds.push(...pts);
    }
    markers.forEach((m) => {
      const mk = L.marker([m.lat, m.lng], { icon: pin(m, m.id === selectedId) }).addTo(layer);
      if (m.popup) mk.bindPopup(m.popup);
      bounds.push([m.lat, m.lng]);
    });
    if (bounds.length) {
      if (!fittedRef.current || trail.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
        fittedRef.current = true;
      }
    }
  }, [markers, trail, selectedId]);

  useEffect(() => {
    const sel = markers.find((m) => m.id === selectedId);
    if (sel && mapRef.current) mapRef.current.setView([sel.lat, sel.lng], Math.max(mapRef.current.getZoom(), 15));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return <div ref={elRef} className={`w-full overflow-hidden rounded-2xl border border-slate-200 ${className}`} />;
}
