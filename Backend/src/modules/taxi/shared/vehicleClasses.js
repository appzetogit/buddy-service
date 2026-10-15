/**
 * Delivery partners register a two-wheeler ("bike" or "scooter"), so a passenger booking in the
 * bike class can be served by either. Other classes (auto, car...) match by their own name.
 */
const SAME_CLASS = {
  bike: ['bike', 'scooter', 'scooty', 'motorcycle'],
  scooter: ['bike', 'scooter', 'scooty', 'motorcycle'],
  scooty: ['bike', 'scooter', 'scooty', 'motorcycle'],
  motorcycle: ['bike', 'scooter', 'scooty', 'motorcycle'],
};

export const expandRiderVehicleKeys = (keys = []) => {
  const out = new Set();
  for (const key of keys) {
    const k = String(key || '').trim().toLowerCase();
    if (!k) continue;
    out.add(k);
    // "Bike Taxi", "bike_lite" etc. count as the bike class too.
    const first = k.split(/[\s_-]+/)[0];
    for (const alias of SAME_CLASS[k] || SAME_CLASS[first] || []) out.add(alias);
  }
  return [...out];
};
