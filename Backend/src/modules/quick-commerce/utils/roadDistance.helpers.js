import { getRoadDistanceKm } from '../../../services/roadDistance.service.js';

export const roadDistanceDetails = (lat1, lon1, lat2, lon2) =>
  getRoadDistanceKm({ lat: lat1, lng: lon1 }, { lat: lat2, lng: lon2 });
