export const mobileRegex = /^[6-9]\d{9}$/;
export const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const accountRegex = /^\d{9,18}$/;
export const documentTypes = ['driving_license', 'vehicle_rc', 'aadhaar', 'pan'] as const;
export const moduleIds = ['app_navigation', 'order_acceptance', 'pickup_delivery', 'customer_interaction', 'traffic_safety', 'platform_policies'] as const;
export const moduleIdAliases: Record<string, typeof moduleIds[number]> = {
  app_usage: 'app_navigation',
  app_navigation_basics: 'app_navigation',
  accepting_orders: 'order_acceptance',
  order_accepting: 'order_acceptance',
  pickup_and_delivery: 'pickup_delivery',
  customer_communication: 'customer_interaction',
  road_safety: 'traffic_safety',
  platform_rules: 'platform_policies',
  platform_rules_earnings: 'platform_policies'
};
export const answerKey = [1, 1, 1, 1, 1, 1, 2, 1, 1, 2];

export function normalizeModuleId(moduleId: string) {
  return moduleIdAliases[moduleId] || moduleId;
}

export function hasValidCoordinates(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function isEnabled(value?: string) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

export function isAdult(date: string) {
  const dob = new Date(date);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 18;
}

export function money(paisa: number) {
  return `₹${(paisa / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function shortMoney(paisa: number) {
  return `+₹${Math.round(paisa / 100)}`;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(r * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 10) / 10;
}

export function maskAccount(account: string) {
  return '••••••••' + account.slice(-4);
}

export function maskPhone(phone?: string) {
  if (!phone) return phone;
  return phone.slice(0, 5) + 'XXXXX';
}
