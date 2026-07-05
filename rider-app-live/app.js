const app = document.getElementById('app');
const logEl = document.getElementById('log');
const socketDot = document.getElementById('socket-dot');
const socketLabel = document.getElementById('socket-label');

let token = localStorage.getItem('vida_rider_token') || '';
let rider = JSON.parse(localStorage.getItem('vida_rider') || 'null');
let currentOffer = JSON.parse(localStorage.getItem('vida_current_offer') || 'null');
let activeOrderId = localStorage.getItem('vida_active_order_id') || '';
let activeDeliveryStatus = localStorage.getItem('vida_active_delivery_status') || '';
let socket = null;
let heartbeatTimer = null;
let lastLiveLocation = JSON.parse(localStorage.getItem('vida_rider_live_location') || 'null');
let lastSentLocation = JSON.parse(localStorage.getItem('vida_rider_sent_location') || 'null');

function baseUrl() {
  return document.getElementById('api-base').value.replace(/\/$/, '');
}

function save() {
  localStorage.setItem('vida_rider_token', token || '');
  localStorage.setItem('vida_rider', JSON.stringify(rider || null));
  localStorage.setItem('vida_current_offer', JSON.stringify(currentOffer || null));
  localStorage.setItem('vida_active_order_id', activeOrderId || '');
  localStorage.setItem('vida_active_delivery_status', activeDeliveryStatus || '');
  localStorage.setItem('vida_rider_live_location', JSON.stringify(lastLiveLocation || null));
  localStorage.setItem('vida_rider_sent_location', JSON.stringify(lastSentLocation || null));
}

function log(type, title, data) {
  const item = document.createElement('div');
  item.className = `log-item ${type}`;
  item.innerHTML = `<strong>${title}</strong><br><span>${new Date().toLocaleTimeString()}</span>${data ? `<pre>${JSON.stringify(data, null, 2).slice(0, 900)}</pre>` : ''}`;
  logEl.prepend(item);
}

function clearLog() {
  logEl.innerHTML = '';
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  const tick = () => {
    if (rider?.rider_id && document.getElementById('city')) sendLocation(true).catch(() => undefined);
  };
  heartbeatTimer = setInterval(tick, activeOrderId ? 7000 : 25000);
  tick();
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(baseUrl() + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  log(res.ok && json.success !== false ? 'ok' : 'err', `${method} ${path} [${res.status}]`, body ? { request: body, response: json } : json);
  if (!res.ok || json.success === false) throw new Error(json.error?.message || json.error?.code || 'API failed');
  return json.data;
}

function connectSocket() {
  if (!token || typeof io === 'undefined') return;
  if (socket) socket.disconnect();
  socket = io(baseUrl(), { path: '/ws', auth: { token } });
  socket.on('connect', () => {
    socketDot.classList.add('on');
    socketDot.classList.remove('off');
    socketLabel.textContent = 'Socket connected';
    log('socket', 'socket connected', { id: socket.id });
  });
  socket.on('disconnect', reason => {
    socketDot.classList.remove('on');
    socketLabel.textContent = 'Socket offline';
    log('socket', 'socket disconnected', { reason });
  });
  socket.on('order_offer', payload => {
    currentOffer = payload;
    activeOrderId = payload.order_id;
    save();
    log('socket', 'order_offer received', payload);
    renderHome();
  });
  socket.on('offer_cancelled', payload => {
    log('socket', 'offer_cancelled', payload);
    if (currentOffer?.offer_id === payload.offer_id) currentOffer = null;
    save();
    renderHome();
  });
  socket.on('order_assigned_confirmed', payload => {
    activeOrderId = payload.order_id;
    activeDeliveryStatus = 'assigned';
    currentOffer = null;
    save();
    log('socket', 'order_assigned_confirmed', payload);
    renderHome();
  });
  socket.on('location_ack', payload => log('socket', 'location_ack', payload));
}

function renderLogin(mobile = '9876543200') {
  app.innerHTML = `
    <div class="screen">
      <div class="title">Rider Test UI</div>
      <div class="sub">Login, go online, receive offers, accept, and move delivery states.</div>
      <div class="card">
        <label>Mobile</label>
        <input id="mobile" value="${mobile}" maxlength="10">
        <button class="btn primary" onclick="sendOtp()">Send OTP</button>
      </div>
    </div>
  `;
}

async function sendOtp() {
  const mobile = document.getElementById('mobile').value;
  const data = await api('POST', '/api/auth/otp/send', { mobile });
  const devOtp = data.dev_otp || '';
  app.innerHTML = `
    <div class="screen">
      <div class="title">Verify OTP</div>
      <div class="sub">Mobile +91 ${mobile}</div>
      <div class="card">
        ${devOtp ? `
          <div style="border:1px solid #bfdbfe; background:#eff6ff; border-radius:12px; padding:12px; margin-bottom:12px; text-align:center;">
            <div style="font-size:11px; font-weight:800; color:#1d4ed8; text-transform:uppercase;">Test OTP</div>
            <div style="font-size:28px; font-weight:900; color:#111827; letter-spacing:8px; margin-top:4px;">${devOtp}</div>
          </div>
        ` : ''}
        <label>OTP</label>
        <input id="otp" value="${devOtp}" maxlength="4">
        <button class="btn primary" onclick="verifyOtp('${mobile}')">Verify</button>
        <button class="btn ghost" onclick="renderLogin('${mobile}')">Change number</button>
      </div>
    </div>
  `;
}

async function verifyOtp(mobile) {
  const otp = document.getElementById('otp').value;
  const data = await api('POST', '/api/auth/otp/verify', { mobile, otp });
  token = data.access_token;
  rider = data.rider;
  save();
  connectSocket();
  renderHome();
}

function renderHome() {
  if (!token || !rider) return renderLogin();
  app.innerHTML = `
    <div class="screen">
      <div class="title">Vida Rider</div>
      <div class="sub">Rider ID: ${rider.rider_id}</div>

      <div class="hero">
        <div class="status-pill" id="status-pill">Checking...</div>
        <div style="font-size:28px; font-weight:850; margin-top:12px;">${rider.name || 'Rider'}</div>
        <div style="font-size:12px; opacity:.8;">Socket offers flash here automatically.</div>
      </div>

      <div class="card">
        <div class="row">
          <div><label>City</label><input id="city" value="Mumbai"></div>
          <div><label>Vehicle</label><select id="vehicle"><option>bike</option><option>scooter</option><option>cargo_bike</option></select></div>
        </div>
        <div class="row">
          <div><label>Lat</label><input id="lat" type="number" value="${lastLiveLocation?.lat || ''}" step="0.000001" placeholder="Detecting..."></div>
          <div><label>Lng</label><input id="lng" type="number" value="${lastLiveLocation?.lng || ''}" step="0.000001" placeholder="Detecting..."></div>
        </div>
        <button class="btn ghost" onclick="useCurrentRiderLocation()">Use Current Location</button>
        <div class="muted" id="location-status">${lastLiveLocation ? `Last live location: ${lastLiveLocation.lat}, ${lastLiveLocation.lng}` : 'Requesting live rider location...'}</div>
        <button class="btn ghost" onclick="activateRider()">Quick Activate Test Rider</button>
        <button class="btn success" onclick="goOnline()">Go Online</button>
        <button class="btn ghost" onclick="sendLocation()">Send Location Update</button>
        <button class="btn danger" onclick="goOffline()">Go Offline</button>
      </div>

      <div id="offer-zone">${offerHtml()}</div>
      <div id="delivery-zone">${deliveryHtml()}</div>

      <div class="card">
        <button class="btn ghost" onclick="refreshStatus()">Refresh Status</button>
        <button class="btn danger" onclick="logout()">Logout</button>
      </div>
    </div>
  `;
  useCurrentRiderLocation(true).catch(() => undefined);
  refreshStatus();
}

function offerHtml() {
  if (!currentOffer) {
    return `<div class="card"><strong>No active offer</strong><div class="muted">Place an order from customer UI while this rider is online. The offer will appear here automatically.</div></div>`;
  }
  return `
    <div class="card offer">
      <div class="status-pill online">New offer</div>
      <div style="margin-top:10px; font-weight:800;">${currentOffer.order_id}</div>
      <div class="muted" style="margin-top:8px;">Customer fare to collect</div>
      <div class="money">${currentOffer.display_customer_fare || currentOffer.display_earnings || `₹${((currentOffer.estimated_earnings || 0) / 100).toFixed(2)}`}</div>
      <div class="kv"><span>Rider earning</span><strong>${currentOffer.display_earnings || '-'}</strong></div>
      <div class="kv"><span>Platform fee</span><strong>${currentOffer.display_platform_fee || '-'}</strong></div>
      <div class="kv"><span>Pickup</span><strong>${currentOffer.pickup?.address || '-'}</strong></div>
      <div class="kv"><span>Dropoff</span><strong>${currentOffer.dropoff?.address || '-'}</strong></div>
      <div class="kv"><span>Distance</span><strong>${currentOffer.distance_km || '-'} km</strong></div>
      <div class="kv"><span>Expires</span><strong>${currentOffer.expires_at ? new Date(currentOffer.expires_at).toLocaleTimeString() : '-'}</strong></div>
      <div class="actions">
        <button class="btn success" onclick="acceptOffer()">Accept</button>
        <button class="btn danger" onclick="rejectOffer()">Reject</button>
      </div>
    </div>
  `;
}

function deliveryHtml() {
  if (!activeOrderId) return '';
  const status = activeDeliveryStatus || 'assigned';
  const steps = deliverySteps();
  const currentIdx = Math.max(0, steps.findIndex(step => step.status === status));
  const stepHtml = steps.map((step, index) => {
    const cls = index < currentIdx ? 'done' : index === currentIdx ? 'active' : '';
    return `
      <div class="delivery-step ${cls}">
        <div class="step-dot">${index < currentIdx ? '✓' : index + 1}</div>
        <div class="step-label">${step.label}</div>
      </div>
    `;
  }).join('');
  return `
    <div class="card">
      <strong>Active Delivery</strong>
      <div class="sub">${activeOrderId}</div>
      <div class="kv"><span>Status</span><strong>${statusLabel(status)}</strong></div>
      <div class="delivery-progress">${stepHtml}</div>
      <div class="delivery-actions">
        ${steps.slice(1).map(step => actionButtonHtml(step, currentIdx, steps)).join('')}
        <button class="btn success ${status === 'delivered' ? 'active-step' : ''}" onclick="markDelivered()">Delivered</button>
      </div>
    </div>
  `;
}

function deliverySteps() {
  return [
    { status: 'assigned', label: 'Assigned' },
    { status: 'en_route_pickup', label: 'En-route', action: 'en-route-pickup' },
    { status: 'arrived_pickup', label: 'Arrived', action: 'arrived-pickup' },
    { status: 'picked_up', label: 'Picked Up', action: 'picked-up' },
    { status: 'in_transit', label: 'In Transit', action: 'in-transit' },
    { status: 'delivered', label: 'Delivered' }
  ];
}

function statusLabel(status) {
  const step = deliverySteps().find(item => item.status === status);
  return step ? step.label : status;
}

function actionButtonHtml(step, currentIdx, steps) {
  if (!step.action) return '';
  const idx = steps.findIndex(item => item.status === step.status);
  const cls = idx < currentIdx ? 'done-step' : idx === currentIdx ? 'active-step' : '';
  const prefix = idx < currentIdx ? '✓ ' : idx === currentIdx ? 'Current: ' : '';
  return `<button class="btn ghost ${cls}" onclick="transition('${step.action}')">${prefix}${step.label}</button>`;
}

async function goOnline() {
  const loc = await getRiderLocationForDispatch();
  await api('POST', '/api/dispatch/online', {
    rider_id: rider.rider_id,
    city: document.getElementById('city').value,
    lat: loc.lat,
    lng: loc.lng,
    vehicle_type: document.getElementById('vehicle').value,
    max_parcel_weight_kg: 10
  });
  startHeartbeat();
  await refreshStatus();
}

async function activateRider() {
  await api('PUT', `/api/rider/profile/${rider.rider_id}`, { name: rider.name || 'Test Rider', city: 'Mumbai', vehicle_type: 'bike', max_parcel_weight_kg: 10 });
  await api('POST', '/api/rider/activate', {});
  const profile = await api('GET', `/api/rider/profile/${rider.rider_id}`);
  rider = { ...rider, name: profile.name, onboarding_status: profile.onboarding_status };
  save();
  renderHome();
}

async function goOffline() {
  await api('POST', '/api/dispatch/offline', { rider_id: rider.rider_id });
  stopHeartbeat();
  currentOffer = null;
  activeOrderId = '';
  activeDeliveryStatus = '';
  save();
  renderHome();
}

async function sendLocation(silent = false) {
  const loc = await getRiderLocationForDispatch();
  if (silent && shouldSkipLocationSend(loc)) return;
  await api('POST', '/api/dispatch/location', {
    rider_id: rider.rider_id,
    city: document.getElementById('city').value,
    lat: loc.lat,
    lng: loc.lng,
    speed: loc.speed,
    bearing: loc.bearing
  });
  lastSentLocation = { ...loc, sent_at: Date.now() };
  save();
  if (!silent) await refreshStatus();
}

function shouldSkipLocationSend(loc) {
  if (!lastSentLocation) return false;
  const minInterval = activeOrderId ? 7000 : 25000;
  const elapsed = Date.now() - Number(lastSentLocation.sent_at || 0);
  const movedMeters = distanceMeters(lastSentLocation.lat, lastSentLocation.lng, loc.lat, loc.lng);
  return elapsed < minInterval || (movedMeters < 30 && elapsed < 60000);
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = n => n * Math.PI / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function useCurrentRiderLocation(silent = false) {
  return readBrowserLocation().then(loc => {
    setRiderLocationInputs(loc);
    if (!silent) log('ok', 'live rider location selected', loc);
    return loc;
  }).catch(err => {
    const statusEl = document.getElementById('location-status');
    if (statusEl) statusEl.textContent = err.message;
    if (!silent) log('err', 'live location unavailable', { message: err.message });
    throw err;
  });
}

async function getRiderLocationForDispatch() {
  try {
    return await useCurrentRiderLocation(true);
  } catch {
    const lat = Number(document.getElementById('lat')?.value);
    const lng = Number(document.getElementById('lng')?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Allow live location or enter rider coordinates manually');
    return { lat, lng, speed: 0, bearing: 0 };
  }
}

function readBrowserLocation() {
  return new Promise((resolve, reject) => {
    const statusEl = document.getElementById('location-status');
    if (!navigator.geolocation) {
      reject(new Error('Live location is not supported in this browser.'));
      return;
    }
    if (statusEl) statusEl.textContent = 'Getting live rider location...';
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: Number(pos.coords.latitude.toFixed(6)),
        lng: Number(pos.coords.longitude.toFixed(6)),
        speed: Number.isFinite(pos.coords.speed) && pos.coords.speed !== null ? Math.round(pos.coords.speed * 3.6) : 0,
        bearing: Number.isFinite(pos.coords.heading) && pos.coords.heading !== null ? Math.round(pos.coords.heading) : 0,
        accuracy: Math.round(pos.coords.accuracy)
      }),
      err => {
        const message = err.code === err.PERMISSION_DENIED
          ? 'Location permission denied. Allow location or enter coordinates manually.'
          : 'Could not get live location. Enter coordinates manually.';
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  });
}

function setRiderLocationInputs(loc) {
  lastLiveLocation = loc;
  const latEl = document.getElementById('lat');
  const lngEl = document.getElementById('lng');
  const statusEl = document.getElementById('location-status');
  if (latEl) latEl.value = loc.lat;
  if (lngEl) lngEl.value = loc.lng;
  if (statusEl) statusEl.textContent = `Live rider location selected. Accuracy ~${loc.accuracy}m.`;
  save();
}

async function acceptOffer() {
  if (!currentOffer) return;
  const data = await api('POST', '/api/dispatch/accept', { offer_id: currentOffer.offer_id, rider_id: rider.rider_id });
  activeOrderId = data.order_id;
  activeDeliveryStatus = 'assigned';
  currentOffer = null;
  save();
  renderHome();
}

async function rejectOffer() {
  if (!currentOffer) return;
  await api('POST', '/api/dispatch/reject', { offer_id: currentOffer.offer_id, rider_id: rider.rider_id, reason: 'not_available' });
  currentOffer = null;
  save();
  renderHome();
}

async function transition(step) {
  if (!activeOrderId) return;
  const data = await api('POST', `/api/dispatch/${step}`, { order_id: activeOrderId, rider_id: rider.rider_id });
  activeDeliveryStatus = data.status || step.replace(/-/g, '_');
  save();
  const zone = document.getElementById('delivery-zone');
  if (zone) zone.innerHTML = deliveryHtml();
  await refreshStatus();
}

async function markDelivered() {
  if (!activeOrderId) return;
  await completeMissingStepsBeforeDelivery();
  const data = await api('POST', '/api/dispatch/delivered', { order_id: activeOrderId, rider_id: rider.rider_id });
  activeOrderId = '';
  activeDeliveryStatus = '';
  save();
  renderHome();
  const pill = document.getElementById('status-pill');
  if (pill) {
    pill.textContent = data.rider_status_after || 'available';
    pill.classList.add('online');
  }
  await refreshStatus();
}

async function completeMissingStepsBeforeDelivery() {
  const steps = [
    ['assigned', 'en-route-pickup'],
    ['en_route_pickup', 'arrived-pickup'],
    ['arrived_pickup', 'picked-up'],
    ['picked_up', 'in-transit']
  ];
  let status = activeDeliveryStatus || 'assigned';
  for (const [from, step] of steps) {
    if (status === from) {
      const data = await api('POST', `/api/dispatch/${step}`, { order_id: activeOrderId, rider_id: rider.rider_id });
      status = data.status || step.replace(/-/g, '_');
      activeDeliveryStatus = status;
      save();
    }
  }
}

async function refreshStatus() {
  if (!rider?.rider_id) return;
  try {
    const data = await api('GET', `/api/dispatch/status?rider_id=${rider.rider_id}`);
    const pill = document.getElementById('status-pill');
    if (pill) {
      pill.textContent = data.status || 'offline';
      pill.classList.toggle('online', data.status !== 'offline');
    }
    if (data.current_order_id) {
      activeOrderId = data.current_order_id;
      activeDeliveryStatus = data.active_delivery?.delivery_status || activeDeliveryStatus;
      save();
      const zone = document.getElementById('delivery-zone');
      if (zone) zone.innerHTML = deliveryHtml();
      startHeartbeat();
    } else if (activeOrderId) {
      activeOrderId = '';
      activeDeliveryStatus = '';
      save();
      const zone = document.getElementById('delivery-zone');
      if (zone) zone.innerHTML = '';
    } else if (data.status && data.status !== 'offline') {
      startHeartbeat();
    }
  } catch (err) {
    log('err', 'status failed', { message: err.message });
  }
}

function logout() {
  token = '';
  rider = null;
  currentOffer = null;
  activeOrderId = '';
  activeDeliveryStatus = '';
  if (socket) socket.disconnect();
  stopHeartbeat();
  localStorage.removeItem('vida_rider_token');
  localStorage.removeItem('vida_rider');
  localStorage.removeItem('vida_current_offer');
  localStorage.removeItem('vida_active_order_id');
  localStorage.removeItem('vida_active_delivery_status');
  renderLogin();
}

if (token && rider) {
  connectSocket();
  renderHome();
} else {
  renderLogin();
}
