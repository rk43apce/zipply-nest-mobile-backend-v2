// ─── Vida Customer App — Live API Integration ───

const app = document.getElementById('app');
const phoneFrame = document.querySelector('.phone-frame');

// ─── State ───
let token = localStorage.getItem('vida_customer_token') || '';
let customer = JSON.parse(localStorage.getItem('vida_customer') || 'null');
let wallet = JSON.parse(localStorage.getItem('vida_wallet') || 'null');
let currentOrder = null;
let currentScreen = '';
let currentTrackingOrderId = '';
let pollTimer = null;
let socket = null;
let liveDispatchNotice = null;

// ─── API Client ───
function getBaseUrl() { return document.getElementById('api-base').value.replace(/\/$/, ''); }

async function api(method, path, body = null) {
    const url = getBaseUrl() + path;
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    logApi(method, path, body);

    try {
        const res = await fetch(url, opts);
        const data = await res.json();
        logApiResponse(method, path, res.status, data);
        if (!data.success && data.error) {
            toast('❌ ' + (data.error.message || data.error.code || 'Error'));
        }
        return data;
    } catch (e) {
        logApiResponse(method, path, 0, { error: e.message });
        toast('❌ Network error: ' + e.message);
        return { success: false, error: { code: 'NETWORK', message: e.message } };
    }
}

function logApi(method, path, body) {
    const el = document.getElementById('api-log-body');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="method ${method}">${method}</span> <span class="url">${path}</span>${body ? `<div class="body">${JSON.stringify(body)}</div>` : ''}`;
    el.prepend(entry);
}

function logApiResponse(method, path, status, data) {
    const el = document.getElementById('api-log-body');
    const first = el.firstChild;
    if (first) {
        const s = status >= 200 && status < 400 ? 'ok' : 'err';
        first.innerHTML += `<div><span class="status ${s}">${status}</span> <span class="body">${JSON.stringify(data).substring(0, 150)}</span></div>`;
    }
}

function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
}

function saveState() {
    localStorage.setItem('vida_customer_token', token);
    localStorage.setItem('vida_customer', JSON.stringify(customer));
    localStorage.setItem('vida_wallet', JSON.stringify(wallet));
}

function connectSocket() {
    if (!token || typeof io === 'undefined') return;
    if (socket) socket.disconnect();
    socket = io(getBaseUrl(), { path: '/ws', auth: { token } });
    socket.on('connect', () => logApiResponse('WS', 'connect', 200, { id: socket.id }));
    socket.on('disconnect', reason => logApiResponse('WS', 'disconnect', 0, { reason }));
    socket.on('rider_offer_sent', payload => {
        liveDispatchNotice = payload;
        toast('📡 ' + (payload.message || 'Offer sent to rider'));
        updateLiveDispatchNotice(payload);
    });
    socket.on('rider_assigned', payload => {
        liveDispatchNotice = { ...payload, status: 'assigned', message: 'Rider assigned' };
        toast('✅ Rider assigned');
        if (currentScreen === 'tracking' && currentTrackingOrderId === payload.order_id) navigate('tracking', { order_id: payload.order_id });
    });
    socket.on('dispatch_update', payload => {
        liveDispatchNotice = payload;
        if (currentScreen === 'tracking' && currentTrackingOrderId === payload.order_id) navigate('tracking', { order_id: payload.order_id });
    });
}

function updateLiveDispatchNotice(payload) {
    const el = document.getElementById('live-dispatch-status');
    if (!el || !payload || (currentOrder && payload.order_id !== currentOrder.order_id)) return;
    el.innerHTML = `
        <div style="display:flex; gap:10px; align-items:center;">
            <span class="material-icons-round" style="font-size:20px; color:#5B2FE8;">rss_feed</span>
            <div>
                <div style="font-size:13px; font-weight:700;">${payload.message || 'Dispatch update received'}</div>
                <div style="font-size:11px; color:#8e8e93;">${payload.riders_offered ? payload.riders_offered + ' rider(s) notified' : payload.status || 'live'}${payload.timeout_seconds ? ' • expires in ' + payload.timeout_seconds + 's' : ''}</div>
            </div>
        </div>
    `;
}

// ─── Router ───
function navigate(screen, data = {}) {
    currentScreen = screen;
    currentTrackingOrderId = screen === 'tracking' ? data.order_id : '';
    const hideNav = ['login', 'otp', 'send_parcel', 'estimate', 'tracking'];
    phoneFrame.classList.toggle('hide-nav', hideNav.includes(screen));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.screen === screen));
    render(screen, data);
}

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.screen));
});

function render(screen, data = {}) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    switch(screen) {
        case 'login': return renderLogin(data);
        case 'otp': return renderOTP(data);
        case 'home': return renderHome();
        case 'send_parcel': return renderSendParcel();
        case 'estimate': return renderEstimate(data);
        case 'tracking': return renderTracking(data);
        case 'orders': return renderOrders();
        case 'wallet': return renderWallet();
        case 'topup': return renderTopup();
        case 'profile': return renderProfile();
        default: return renderHome();
    }
}

// ─── Auth Screens ───
function renderLogin(data = {}) {
    const mobile = data.mobile || '';
    app.innerHTML = `
        <div class="screen" style="padding:32px 20px;">
            <div style="text-align:center; margin-bottom:24px;">
                <h1 style="font-size:24px; font-weight:800; color:#1a1a2e;">Welcome to Vida 👋</h1>
                <p style="font-size:13px; color:#8e8e93; margin-top:4px;">Enter mobile number to continue</p>
            </div>
            <div class="input-group">
                <label>Mobile Number</label>
                <div style="display:flex; border:1.5px solid #e5e5ea; border-radius:12px; overflow:hidden;">
                    <span style="padding:12px; background:#f8f8fa; font-size:14px; font-weight:600; border-right:1px solid #e5e5ea;">+91</span>
                    <input type="tel" id="login-phone" class="input-field" style="border:none; border-radius:0;" placeholder="9871234567" maxlength="10" value="${mobile}">
                </div>
            </div>
            <button class="btn btn-primary" onclick="sendOTP()">Send OTP</button>
        </div>
    `;
}

async function sendOTP() {
    const mobile = document.getElementById('login-phone').value;
    if (mobile.length !== 10) return toast('Enter 10 digit number');
    const res = await api('POST', '/api/customer/otp/send', { mobile });
    if (res.success) {
        toast('✅ OTP sent' + (res.data.dev_otp ? ` (Dev: ${res.data.dev_otp})` : ''));
        navigate('otp', { mobile, dev_otp: res.data.dev_otp });
    }
}

function renderOTP(data) {
    app.innerHTML = `
        <div class="screen" style="padding:32px 20px;">
            <button style="border:none; background:none; color:#5B2FE8; font-size:14px; font-weight:600; cursor:pointer;" onclick="navigate('login', { mobile: '${data.mobile}' })">← Back</button>
            <div style="text-align:center; margin:20px 0;">
                <h1 style="font-size:22px; font-weight:800;">Verify OTP</h1>
                <p style="font-size:13px; color:#8e8e93;">Sent to +91 ${data.mobile}</p>
            </div>
            ${data.dev_otp ? `
                <div style="border:1px solid #ddd6fe; background:#f5f3ff; border-radius:14px; padding:14px; margin-bottom:16px; text-align:center;">
                    <div style="font-size:11px; font-weight:800; color:#5B2FE8; text-transform:uppercase;">Test OTP</div>
                    <div style="font-size:30px; font-weight:900; color:#1a1a2e; letter-spacing:8px; margin-top:4px;">${data.dev_otp}</div>
                </div>
            ` : ''}
            <div class="input-group">
                <label>Enter OTP</label>
                <input type="text" id="otp-input" class="input-field" placeholder="1234" maxlength="4" style="text-align:center; font-size:24px; font-weight:700; letter-spacing:12px;">
            </div>
            <button class="btn btn-primary" onclick="verifyOTP('${data.mobile}')">Verify & Continue</button>
            <button class="btn btn-secondary" style="margin-top:10px;" onclick="navigate('login', { mobile: '${data.mobile}' })">Change Number</button>
        </div>
    `;
    document.getElementById('otp-input').value = data.dev_otp || '';
}

async function verifyOTP(mobile) {
    const otp = document.getElementById('otp-input').value;
    if (otp.length !== 4) return toast('Enter 4 digit OTP');
    const res = await api('POST', '/api/customer/otp/verify', { mobile, otp });
    if (res.success) {
        token = res.data.access_token;
        customer = res.data.customer;
        wallet = res.data.wallet;
        saveState();
        connectSocket();
        toast('✅ Logged in!');
        navigate('home');
    }
}

// ─── Home ───
async function renderHome() {
    if (!token) return navigate('login');

    // Fetch wallet balance
    if (wallet?.wallet_id) {
        const wRes = await api('GET', `/api/wallet/${wallet.wallet_id}`);
        if (wRes.success) wallet = wRes.data;
    }

    // Fetch profile
    const pRes = await api('GET', '/api/customer/profile');
    if (pRes.success) { customer = pRes.data; if (pRes.data.wallet) wallet = pRes.data.wallet; }
    saveState();

    app.innerHTML = `
        <div class="screen">
            <div class="screen-header">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:12px; color:#8e8e93;">Good day</div>
                        <div class="screen-title">Hey, ${customer?.name || 'there'} 👋</div>
                    </div>
                </div>
            </div>
            <div class="hero-card">
                <div style="font-size:11px; opacity:0.8;">Wallet Balance</div>
                <div style="font-size:28px; font-weight:800; margin:4px 0;">${wallet?.display_balance || wallet?.display_available || '₹0.00'}</div>
                <div style="font-size:11px; opacity:0.7;">Available: ${wallet?.display_available || '₹0.00'}</div>
            </div>
            <div class="stat-grid">
                <div class="stat-box" onclick="navigate('send_parcel')" style="cursor:pointer;">
                    <div style="font-size:20px;">📦</div>
                    <div class="stat-label" style="margin-top:4px;">Send Parcel</div>
                </div>
                <div class="stat-box" onclick="navigate('topup')" style="cursor:pointer;">
                    <div style="font-size:20px;">💰</div>
                    <div class="stat-label" style="margin-top:4px;">Add Money</div>
                </div>
            </div>
            <div style="padding:0 20px 8px; font-size:14px; font-weight:700;">Recent Orders</div>
            <div id="home-orders"><div class="loading">Loading orders...</div></div>
        </div>
    `;
    loadRecentOrders();
}

async function loadRecentOrders() {
    const res = await api('GET', '/api/orders?page=1&limit=5');
    const el = document.getElementById('home-orders');
    if (!res.success || !res.data?.orders?.length) { el.innerHTML = '<div class="card" style="text-align:center; color:#8e8e93; font-size:13px;">No orders yet. Send your first parcel!</div>'; return; }
    el.innerHTML = res.data.orders.map(o => `
        <div class="order-card" onclick="navigate('tracking', {order_id:'${o.order_id}'})">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-size:12px; font-weight:700;">${o.order_id}</span>
                <span class="badge badge-${o.status}">${o.status}</span>
            </div>
            <div style="font-size:11px; color:#8e8e93;">${o.pickup_address || ''} → ${o.dropoff_address || ''}</div>
            <div style="font-size:11px; color:#8e8e93; margin-top:4px;">${o.display_total || '₹' + (o.total_amount/100).toFixed(2)}</div>
        </div>
    `).join('');
}

// ─── Send Parcel ───
function renderSendParcel() {
    app.innerHTML = `
        <div class="screen">
            <div class="screen-header">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span class="material-icons-round" style="cursor:pointer;" onclick="navigate('home')">arrow_back</span>
                    <span class="screen-title" style="font-size:18px;">Send a Parcel</span>
                </div>
            </div>
            <div class="card">
                <div class="input-group"><label>Pickup Address</label><input type="text" class="input-field" id="f-pickup-addr" placeholder="Use current location or enter pickup address"></div>
                <div style="display:flex; gap:8px;">
                    <div class="input-group" style="flex:1;"><label>Pickup Lat</label><input type="number" class="input-field" id="f-pickup-lat" step="0.000001" placeholder="Detecting..."></div>
                    <div class="input-group" style="flex:1;"><label>Pickup Lng</label><input type="number" class="input-field" id="f-pickup-lng" step="0.000001" placeholder="Detecting..."></div>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="useCurrentPickupLocation()">Use Current Location</button>
                <div id="pickup-location-status" style="font-size:11px; color:#8e8e93; margin-top:8px;">Requesting live location...</div>
                <div class="input-group"><label>Pickup Contact</label><input type="text" class="input-field" id="f-pickup-name" value="${customer?.name || 'Customer'}"></div>
                <div class="input-group"><label>Pickup Phone</label><input type="tel" class="input-field" id="f-pickup-phone" value="9876543210" maxlength="10"></div>
            </div>
            <div class="card">
                <div class="input-group"><label>Dropoff Address</label><input type="text" class="input-field" id="f-drop-addr" value="Drop location near 28.6366, 77.2743"></div>
                <div style="display:flex; gap:8px;">
                    <div class="input-group" style="flex:1;"><label>Dropoff Lat</label><input type="number" class="input-field" id="f-drop-lat" value="28.6366" step="0.0001"></div>
                    <div class="input-group" style="flex:1;"><label>Dropoff Lng</label><input type="number" class="input-field" id="f-drop-lng" value="77.2743" step="0.0001"></div>
                </div>
                <div class="input-group"><label>Receiver Name</label><input type="text" class="input-field" id="f-drop-name" value="Priya Sharma"></div>
                <div class="input-group"><label>Receiver Phone</label><input type="tel" class="input-field" id="f-drop-phone" value="9871234567" maxlength="10"></div>
            </div>
            <div class="card">
                <div class="input-group"><label>Weight (kg)</label><input type="number" class="input-field" id="f-weight" value="2.5" step="0.5"></div>
                <div class="input-group" style="margin-bottom:0;"><label>Special Notes</label><input type="text" class="input-field" id="f-notes" value="Handle with care — fragile items"></div>
            </div>
            <div style="padding:12px 16px;"><button class="btn btn-primary" onclick="getEstimate()">Get Price Estimate →</button></div>
        </div>
    `;
    useCurrentPickupLocation();
}

async function getEstimate() {
    const data = getFormData();
    if (!Number.isFinite(data.pickup_lat) || !Number.isFinite(data.pickup_lng)) {
        toast('Please allow current location or enter pickup coordinates.');
        return;
    }
    const res = await api('POST', '/api/orders/estimate', {
        pickup: { lat: data.pickup_lat, lng: data.pickup_lng },
        dropoff: { lat: data.drop_lat, lng: data.drop_lng },
        parcel: { weight_kg: data.weight }
    });
    if (res.success) navigate('estimate', { ...data, pricing: res.data });
}

function useCurrentPickupLocation() {
    const statusEl = document.getElementById('pickup-location-status');
    if (!navigator.geolocation) {
        if (statusEl) statusEl.textContent = 'Live location is not supported in this browser.';
        return;
    }
    if (statusEl) statusEl.textContent = 'Getting live location...';
    navigator.geolocation.getCurrentPosition(
        pos => {
            const lat = Number(pos.coords.latitude.toFixed(6));
            const lng = Number(pos.coords.longitude.toFixed(6));
            const latEl = document.getElementById('f-pickup-lat');
            const lngEl = document.getElementById('f-pickup-lng');
            const addrEl = document.getElementById('f-pickup-addr');
            if (latEl) latEl.value = lat;
            if (lngEl) lngEl.value = lng;
            if (addrEl && !addrEl.value.trim()) addrEl.value = `Current location (${lat}, ${lng})`;
            if (statusEl) statusEl.textContent = `Live location selected. Accuracy ~${Math.round(pos.coords.accuracy)}m.`;
        },
        err => {
            if (statusEl) statusEl.textContent = err.code === err.PERMISSION_DENIED
                ? 'Location permission denied. Allow location or enter pickup coordinates manually.'
                : 'Could not get live location. Enter pickup coordinates manually.';
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
}

function getFormData() {
    return {
        pickup_addr: document.getElementById('f-pickup-addr').value,
        pickup_lat: parseFloat(document.getElementById('f-pickup-lat').value),
        pickup_lng: parseFloat(document.getElementById('f-pickup-lng').value),
        pickup_name: document.getElementById('f-pickup-name').value,
        pickup_phone: document.getElementById('f-pickup-phone').value,
        drop_addr: document.getElementById('f-drop-addr').value,
        drop_lat: parseFloat(document.getElementById('f-drop-lat').value),
        drop_lng: parseFloat(document.getElementById('f-drop-lng').value),
        drop_name: document.getElementById('f-drop-name').value,
        drop_phone: document.getElementById('f-drop-phone').value,
        weight: parseFloat(document.getElementById('f-weight').value),
        notes: document.getElementById('f-notes').value,
    };
}

// ─── Estimate & Confirm ───
function renderEstimate(data) {
    const p = data.pricing?.pricing || data.pricing;
    app.innerHTML = `
        <div class="screen">
            <div class="screen-header">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span class="material-icons-round" style="cursor:pointer;" onclick="navigate('send_parcel')">arrow_back</span>
                    <span class="screen-title" style="font-size:18px;">Confirm Order</span>
                </div>
            </div>
            <div class="card">
                <div style="font-size:13px; font-weight:700; margin-bottom:8px;">Route</div>
                <div style="font-size:12px; color:#8e8e93;">📍 ${data.pickup_addr}</div>
                <div style="font-size:12px; color:#8e8e93; margin-top:4px;">🏠 ${data.drop_addr}</div>
                <div style="font-size:11px; color:#5B2FE8; margin-top:6px;">${data.pricing?.distance_km || '?'} km • ~${data.pricing?.estimated_minutes || '?'} min</div>
            </div>
            <div class="card">
                <div style="font-size:13px; font-weight:700; margin-bottom:8px;">Price Breakdown</div>
                <div style="display:flex; justify-content:space-between; font-size:12px; padding:4px 0;"><span>Base fare</span><span>${p?.display_base || '₹40.00'}</span></div>
                <div style="display:flex; justify-content:space-between; font-size:12px; padding:4px 0;"><span>Distance</span><span>${p?.display_distance || '—'}</span></div>
                ${p?.weight_surcharge > 0 ? `<div style="display:flex; justify-content:space-between; font-size:12px; padding:4px 0;"><span>Weight surcharge</span><span>${p.display_weight}</span></div>` : ''}
                <div style="display:flex; justify-content:space-between; font-size:12px; padding:4px 0;"><span>Platform fee</span><span>${p?.display_platform || '₹5.00'}</span></div>
                <div style="display:flex; justify-content:space-between; font-size:14px; font-weight:700; padding:8px 0; border-top:1px solid #f0f0f0; margin-top:4px;"><span>Total</span><span>${p?.display_total || '—'}</span></div>
            </div>
            <div class="card">
                <div style="font-size:13px; font-weight:700; margin-bottom:10px;">Payment Method</div>
                <div class="payment-options">
                    <button class="payment-option active" data-payment="wallet" onclick="selectPaymentMethod('wallet')">
                        <span class="material-icons-round">account_balance_wallet</span>
                        <span>Wallet</span>
                        <small>${wallet?.display_available || '₹0.00'}</small>
                    </button>
                    <button class="payment-option" data-payment="cash" onclick="selectPaymentMethod('cash')">
                        <span class="material-icons-round">payments</span>
                        <span>Cash</span>
                        <small>Pay on delivery</small>
                    </button>
                    <button class="payment-option" data-payment="online" onclick="selectPaymentMethod('online')">
                        <span class="material-icons-round">credit_card</span>
                        <span>Online</span>
                        <small>Dev confirm</small>
                    </button>
                </div>
            </div>
            <div id="payment-error"></div>
            <div style="padding:0 16px 12px;"><button class="btn btn-primary" id="place-order-btn" onclick="placeOrder()">Confirm & Place Order</button></div>
        </div>
    `;
    // Store data for placeOrder
    window._orderData = data;
    window._paymentMethod = 'wallet';
    window._orderIdempotencyKey = 'order_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function selectPaymentMethod(method) {
    window._paymentMethod = method;
    document.querySelectorAll('.payment-option').forEach(el => {
        el.classList.toggle('active', el.dataset.payment === method);
    });
    const err = document.getElementById('payment-error');
    if (err) err.innerHTML = '';
}

async function placeOrder() {
    const d = window._orderData;
    const paymentMethod = window._paymentMethod || 'wallet';
    clearInterval(pollTimer);
    pollTimer = null;
    currentOrder = null;
    currentTrackingOrderId = '';
    if (paymentMethod === 'wallet' && !walletHasBalance(d)) {
        showPaymentError('Wallet balance is low. Add money or choose Cash/Online to continue.');
        return;
    }
    const btn = document.getElementById('place-order-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Placing order...'; }
    const res = await api('POST', '/api/orders/create', {
        idempotency_key: window._orderIdempotencyKey,
        pickup: { lat: d.pickup_lat, lng: d.pickup_lng, address: d.pickup_addr, contact_name: d.pickup_name, contact_phone: d.pickup_phone },
        dropoff: { lat: d.drop_lat, lng: d.drop_lng, address: d.drop_addr, contact_name: d.drop_name, contact_phone: d.drop_phone },
        parcel: { weight_kg: d.weight, special_notes: d.notes },
        payment_method: paymentMethod
    });
    if (res.success) {
        toast('✅ Order placed: ' + res.data.order_id);
        currentOrder = res.data;
        if (paymentMethod === 'online') {
            await confirmOnlineOrder(res.data.order_id);
        }
        navigate('tracking', { order_id: res.data.order_id });
    } else {
        if (res.error?.code === 'INSUFFICIENT_BALANCE') {
            await refreshWallet();
            showPaymentError(res.error.message || 'Wallet balance is low. Add money or choose Cash/Online to continue.');
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm & Place Order'; }
    }
}

function walletHasBalance(orderData) {
    const total = orderData.pricing?.pricing?.total || orderData.pricing?.total || 0;
    return Number(wallet?.available_balance || 0) >= Number(total || 0);
}

function showPaymentError(message) {
    const el = document.getElementById('payment-error');
    if (!el) return;
    el.innerHTML = `
        <div class="payment-error">
            <div><b>${message}</b></div>
            <div class="payment-error-actions">
                <button class="btn btn-secondary btn-sm" onclick="navigate('topup')">Add Money</button>
                <button class="btn btn-secondary btn-sm" onclick="selectPaymentMethod('cash')">Use Cash</button>
                <button class="btn btn-secondary btn-sm" onclick="selectPaymentMethod('online')">Use Online</button>
            </div>
        </div>
    `;
}

async function refreshWallet() {
    if (!wallet?.wallet_id) return;
    const res = await api('GET', `/api/wallet/${wallet.wallet_id}`);
    if (res.success) { wallet = res.data; saveState(); }
}

async function confirmOnlineOrder(orderId) {
    const res = await api('POST', `/api/orders/${orderId}/online/confirm`, {});
    if (res.success) toast('✅ Online payment confirmed');
}

function normalizeTimeline(events, order) {
    const labels = {
        order_confirmed: ['Order Confirmed', order.payment?.method === 'cash' ? 'Cash payment selected' : 'Order confirmed'],
        dispatch_started: ['Finding Rider', 'Searching for nearby riders'],
        rider_assigned: ['Rider Assigned', `${order.rider?.name || 'Rider'} assigned`],
        en_route_pickup: ['En-route Pickup', `${order.rider?.name || 'Rider'} is heading to pickup`],
        arrived_pickup: ['At Pickup', 'Rider arrived at pickup'],
        picked_up: ['Picked Up', 'Order picked up'],
        in_transit: ['In Transit', 'Order is on the way'],
        delivered: ['Delivered', 'Order delivered'],
        cancelled: ['Cancelled', 'Order cancelled']
    };
    const cleaned = (events || []).map(event => {
        const [title, description] = labels[event.event_type] || [event.title || event.event_type, event.description || ''];
        return { ...event, title, description: event.description || description };
    });
    if (cleaned.length) return cleaned;
    const flow = ['order_confirmed', 'dispatch_started', 'rider_assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'delivered'];
    const statusToEvent = { confirmed: 'order_confirmed', searching: 'dispatch_started', assigned: 'rider_assigned', en_route_pickup: 'en_route_pickup', arrived_pickup: 'arrived_pickup', picked_up: 'picked_up', in_transit: 'in_transit', delivered: 'delivered', cancelled: 'cancelled' };
    const current = statusToEvent[order.status] || 'order_confirmed';
    const idx = Math.max(0, flow.indexOf(current));
    const synthetic = flow.slice(0, idx + 1);
    if (order.status === 'cancelled') synthetic.push('cancelled');
    return synthetic.map(event_type => {
        const [title, description] = labels[event_type];
        return { event_type, title, description, created_at: order.updated_at || order.created_at || new Date().toISOString() };
    });
}

// ─── Order Tracking ───
async function renderTracking(data) {
    const orderId = data.order_id;
    app.innerHTML = `<div class="loading">Loading order...</div>`;

    const res = await api('GET', `/api/orders/${orderId}`);
    if (!res.success) { app.innerHTML = `<div class="error-msg">Order not found</div>`; return; }
    const order = res.data;
    currentOrder = order;

    const timeRes = await api('GET', `/api/orders/${orderId}/timeline`);
    const events = normalizeTimeline(timeRes.success ? timeRes.data.events : [], order);

    const statusMessages = {
        confirmed: 'Order confirmed',
        searching: 'Finding a rider for you...',
        assigned: `${order.rider?.name || 'Rider'} is heading to pickup!`,
        en_route_pickup: `${order.rider?.name || 'Rider'} is heading to pickup!`,
        arrived_pickup: 'Rider arrived at pickup point!',
        picked_up: 'Your order has been picked up!',
        in_transit: 'Your order is on the way!',
        delivered: 'Your order has been delivered! 🎉',
        cancelled: 'Order cancelled',
    };

    const allSteps = ['confirmed', 'searching', 'assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'delivered'];
    const stepLabels = { confirmed: 'Confirmed', searching: 'Finding Rider', assigned: 'Rider Assigned', en_route_pickup: 'En-route', arrived_pickup: 'At Pickup', picked_up: 'Picked Up', in_transit: 'In Transit', delivered: 'Delivered' };
    const currentIdx = Math.max(0, allSteps.indexOf(order.status));

    let riderHtml = '';
    if (order.rider) {
        riderHtml = `
            <div class="card">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:40px; height:40px; border-radius:50%; background:#5B2FE815; display:flex; align-items:center; justify-content:center; font-weight:700; color:#5B2FE8;">${(order.rider.name||'R')[0]}</div>
                    <div style="flex:1;">
                        <div style="font-size:13px; font-weight:600;">${order.rider.name}</div>
                        <div style="font-size:11px; color:#8e8e93;">${order.rider.vehicle_type || 'Bike'} • ★ ${order.rider.rating || '—'} • ${order.rider.phone_masked || ''}</div>
                    </div>
                    <div style="font-size:12px; color:#5B2FE8; font-weight:600;">${order.rider.eta_minutes ? order.rider.eta_minutes + ' min' : ''}</div>
                </div>
            </div>
        `;
    }

    let cancelBtn = '';
    if (order.can_cancel) {
        const fee = order.cancellation_fee || 0;
        cancelBtn = `<div style="padding:0 16px; margin-top:8px;"><button class="btn btn-danger btn-sm" onclick="cancelOrder('${orderId}')">Cancel Order ${fee > 0 ? '(₹' + (fee/100) + ' fee)' : '(Free)'}</button></div>`;
    }

    app.innerHTML = `
        <div class="screen">
            <div class="screen-header">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span class="material-icons-round" style="cursor:pointer;" onclick="navigate('home')">arrow_back</span>
                    <div>
                        <div style="font-size:14px; font-weight:700;">${orderId}</div>
                        <div style="font-size:12px; color:#8e8e93;">${statusMessages[order.status] || order.status}</div>
                    </div>
                    <span class="badge badge-${order.status}" style="margin-left:auto;">${order.status}</span>
                </div>
            </div>

            ${riderHtml}

            <div class="card" id="live-dispatch-status">
                <div style="display:flex; gap:10px; align-items:center;">
                    <span class="material-icons-round" style="font-size:20px; color:#5B2FE8;">travel_explore</span>
                    <div>
                        <div style="font-size:13px; font-weight:700;">${liveDispatchNotice?.order_id === orderId ? (liveDispatchNotice.message || 'Dispatch update received') : (order.status === 'searching' ? 'Searching nearby riders' : statusMessages[order.status] || order.status)}</div>
                        <div style="font-size:11px; color:#8e8e93;">Live rider matching updates appear here</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div style="font-size:12px; font-weight:700; margin-bottom:8px;">Progress</div>
                <div class="timeline">
                    ${allSteps.map((step, i) => {
                        let cls = i < currentIdx ? 'done' : i === currentIdx ? 'active' : '';
                        return `<div class="timeline-item ${cls}">
                            <div class="timeline-dot"><span class="material-icons-round" style="font-size:14px;">${i <= currentIdx ? 'check' : 'circle'}</span></div>
                            <div class="timeline-content"><h4>${stepLabels[step]}</h4></div>
                        </div>`;
                    }).join('')}
                </div>
            </div>

            ${events.length ? `
                <div class="card">
                    <div style="font-size:12px; font-weight:700; margin-bottom:8px;">Timeline</div>
                    ${events.map(e => `<div style="font-size:11px; padding:4px 0; border-bottom:1px solid #f8f8f8;"><b>${e.title}</b> — ${e.description || ''}<br><span style="color:#8e8e93;">${new Date(e.created_at).toLocaleTimeString()}</span></div>`).join('')}
                </div>
            ` : ''}

            <div class="card">
                <div style="font-size:12px;"><b>Total:</b> ${order.pricing?.display_total || '₹' + ((order.total_amount||0)/100).toFixed(2)} | <b>Payment:</b> ${order.payment?.method || order.payment_method || 'wallet'}</div>
            </div>

            ${cancelBtn}

            ${order.status === 'delivered' && !order.is_rated ? `
                <div style="padding:0 16px; margin-top:8px;"><button class="btn btn-primary" onclick="rateOrder('${orderId}')">⭐ Rate Delivery</button></div>
            ` : ''}

            <div style="padding:8px 16px;">
                <button class="btn btn-secondary btn-sm" onclick="navigate('tracking', {order_id:'${orderId}'})">🔄 Refresh</button>
            </div>
        </div>
    `;

    // Socket updates drive live tracking; this is only a slow reconnect/fallback refresh.
    if (['searching', 'assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit'].includes(order.status)) {
        pollTimer = setInterval(() => {
            if (!socket || !socket.connected) navigate('tracking', { order_id: orderId });
        }, 60000);
    }
}

async function cancelOrder(orderId) {
    if (!confirm('Cancel this order?')) return;
    const res = await api('POST', `/api/orders/${orderId}/cancel`, { reason: 'Changed my mind' });
    if (res.success) {
        toast('✅ ' + res.data.message);
        navigate('tracking', { order_id: orderId });
    }
}

async function rateOrder(orderId) {
    const rating = prompt('Rate delivery (1-5):');
    if (!rating || rating < 1 || rating > 5) return;
    const res = await api('POST', `/api/orders/${orderId}/rate`, { delivery_rating: parseInt(rating), rider_rating: parseInt(rating), comments: '' });
    if (res.success) { toast('✅ Rated!'); navigate('tracking', { order_id: orderId }); }
}

// ─── Orders List ───
async function renderOrders() {
    if (!token) return navigate('login');
    app.innerHTML = `<div class="screen"><div class="screen-header"><div class="screen-title">My Orders</div></div><div class="loading">Loading...</div></div>`;
    const res = await api('GET', '/api/orders?page=1&limit=20');
    if (!res.success) { app.innerHTML = `<div class="error-msg">Failed to load orders</div>`; return; }
    const orders = res.data.orders || [];
    app.innerHTML = `
        <div class="screen">
            <div class="screen-header"><div class="screen-title">My Orders</div><div class="screen-subtitle">${res.data.pagination?.total || orders.length} orders</div></div>
            ${orders.length === 0 ? '<div class="card" style="text-align:center; color:#8e8e93; font-size:13px;">No orders yet</div>' : ''}
            ${orders.map(o => `
                <div class="order-card" onclick="navigate('tracking', {order_id:'${o.order_id}'})">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:12px; font-weight:700;">${o.order_id}</span>
                        <span class="badge badge-${o.status}">${o.status}</span>
                    </div>
                    <div style="font-size:11px; color:#8e8e93; margin-top:4px;">${o.pickup_address || ''} → ${o.dropoff_address || ''}</div>
                    <div style="display:flex; justify-content:space-between; font-size:11px; color:#8e8e93; margin-top:4px;">
                        <span>${o.created_at ? new Date(o.created_at).toLocaleDateString() : ''}</span>
                        <span style="font-weight:600; color:#1a1a2e;">${o.display_total || '₹' + ((o.total_amount||0)/100).toFixed(2)}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ─── Wallet ───
async function renderWallet() {
    if (!token) return navigate('login');
    app.innerHTML = `<div class="screen"><div class="loading">Loading wallet...</div></div>`;

    // Fetch wallet
    if (wallet?.wallet_id) {
        const wRes = await api('GET', `/api/wallet/${wallet.wallet_id}`);
        if (wRes.success) wallet = wRes.data;
    }

    // Fetch transactions
    const txnRes = await api('GET', `/api/wallet/${wallet?.wallet_id}/transactions?page=1&limit=10`);
    const transactions = txnRes.success ? (txnRes.data.transactions || []) : [];

    app.innerHTML = `
        <div class="screen">
            <div class="screen-header"><div class="screen-title">Wallet</div></div>
            <div style="background:#1a1a2e; margin:0 16px; border-radius:18px; padding:20px; color:white;">
                <div style="font-size:11px; opacity:0.7;">Available Balance</div>
                <div style="font-size:30px; font-weight:800; margin:4px 0;">${wallet?.display_available || wallet?.display_balance || '₹0.00'}</div>
                <div style="font-size:10px; opacity:0.5;">Total: ${wallet?.display_balance || '₹0.00'}</div>
            </div>
            <div style="display:flex; gap:10px; padding:12px 16px;">
                <button class="btn btn-primary btn-sm" onclick="navigate('topup')">+ Add Money</button>
                <button class="btn btn-secondary btn-sm" onclick="renderWallet()">↻ Refresh</button>
            </div>
            <div style="padding:0 20px 6px; font-size:13px; font-weight:700;">Transactions</div>
            <div class="card">
                ${transactions.length === 0 ? '<div style="text-align:center; color:#8e8e93; font-size:12px; padding:12px;">No transactions yet</div>' : ''}
                ${transactions.map(t => `
                    <div class="txn-item">
                        <div class="txn-icon ${t.txn_type}">${t.txn_type === 'credit' ? '↓' : '↑'}</div>
                        <div class="txn-info">
                            <h4>${t.description || t.txn_category}</h4>
                            <p>${new Date(t.created_at).toLocaleString()}</p>
                        </div>
                        <div class="txn-amount ${t.txn_type}">${t.display_amount || (t.txn_type === 'credit' ? '+' : '-') + '₹' + (t.amount/100).toFixed(2)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ─── Top-up ───
let selectedTopupAmount = 50000;

function renderTopup() {
    app.innerHTML = `
        <div class="screen">
            <div class="screen-header">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span class="material-icons-round" style="cursor:pointer;" onclick="navigate('wallet')">arrow_back</span>
                    <span class="screen-title" style="font-size:18px;">Add Money</span>
                </div>
            </div>
            <div class="card">
                <div class="input-group">
                    <label>Amount (₹)</label>
                    <input type="number" class="input-field" id="topup-amount" value="500" style="font-size:22px; font-weight:700;">
                </div>
                <div class="amount-chips">
                    <span class="amount-chip" onclick="setTopup(100)">₹100</span>
                    <span class="amount-chip" onclick="setTopup(200)">₹200</span>
                    <span class="amount-chip selected" onclick="setTopup(500)">₹500</span>
                    <span class="amount-chip" onclick="setTopup(1000)">₹1,000</span>
                    <span class="amount-chip" onclick="setTopup(2000)">₹2,000</span>
                    <span class="amount-chip" onclick="setTopup(5000)">₹5,000</span>
                </div>
            </div>
            <div style="padding:0 16px;"><button class="btn btn-primary" onclick="initiateTopup()">Add Money</button></div>
            <div style="padding:8px 16px; font-size:11px; color:#8e8e93;">Daily limit: ₹10,000 | Monthly limit: ₹1,00,000</div>
            <div id="topup-status"></div>
        </div>
    `;
}

function setTopup(amount) {
    document.getElementById('topup-amount').value = amount;
    document.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));
    event.target.classList.add('selected');
}

async function initiateTopup() {
    const amount = parseInt(document.getElementById('topup-amount').value) * 100; // Convert to paisa
    if (amount < 100) return toast('Minimum ₹1');

    const idempKey = 'topup_' + wallet.wallet_id + '_' + Date.now();
    const res = await api('POST', '/api/wallet/topup/initiate', {
        wallet_id: wallet.wallet_id,
        amount: amount,
        idempotency_key: idempKey
    });

    if (!res.success) return;

    const statusEl = document.getElementById('topup-status');

    statusEl.innerHTML = `
        <div class="success-msg">
            Razorpay checkout opened (${res.data.status})<br>
            Payment ID: ${res.data.payment_txn_id}<br>
            Gateway Order: ${res.data.gateway_order_id || 'N/A'}<br>
            Amount: ₹${(res.data.amount / 100).toFixed(2)}
        </div>
        <div style="padding:8px 16px;">
            <button class="btn btn-success btn-sm" onclick="simulateTopupSuccess('${res.data.payment_txn_id}')">
                Payment Success
            </button>
            <button class="btn btn-secondary btn-sm" onclick="simulateTopupFailure('${res.data.payment_txn_id}')" style="margin-top:8px;">
                Payment Failed
            </button>
        </div>
    `;
}

async function simulateTopupSuccess(paymentTxnId) {
    const res = await api('POST', `/api/wallet/topup/simulate/${paymentTxnId}/success`, {
        gateway_payment_id: 'pay_sim_' + Date.now(),
        status: 'captured'
    });
    if (res.success) {
        toast('Money added. New balance: ' + (res.data.display_new_balance || ''));
        const wRes = await api('GET', `/api/wallet/${wallet.wallet_id}`);
        if (wRes.success) { wallet = wRes.data; saveState(); }
        navigate('wallet');
    } else {
        toast('Payment capture failed');
    }
}

async function simulateTopupFailure(paymentTxnId) {
    const res = await api('POST', `/api/wallet/topup/simulate/${paymentTxnId}/failure`, {
        gateway_payment_id: 'pay_sim_' + Date.now(),
        reason: 'customer_cancelled'
    });
    if (res.success) {
        const statusEl = document.getElementById('topup-status');
        if (statusEl) {
            statusEl.innerHTML = `
                <div class="error-msg">
                    Payment failed. Wallet was not credited.
                </div>
            `;
        }
        toast('Payment failed. Please try again or choose cash/online.');
    } else {
        toast('Payment failure update failed');
    }
}

// ─── Profile ───
async function renderProfile() {
    if (!token) return navigate('login');
    const res = await api('GET', '/api/customer/profile');
    if (res.success) { customer = res.data; saveState(); }

    app.innerHTML = `
        <div class="screen">
            <div style="text-align:center; padding:24px;">
                <div style="width:64px; height:64px; border-radius:50%; background:linear-gradient(135deg,#5B2FE8,#8B5CF6); margin:0 auto 10px; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:700; color:white;">${(customer?.name || 'U')[0]}</div>
                <div style="font-size:16px; font-weight:700;">${customer?.name || 'Set your name'}</div>
                <div style="font-size:12px; color:#8e8e93;">+91 ${customer?.mobile || ''}</div>
            </div>
            <div class="card">
                <div class="input-group"><label>Name</label><input type="text" class="input-field" id="prof-name" value="${customer?.name || ''}"></div>
                <div class="input-group" style="margin-bottom:0;"><label>Email</label><input type="email" class="input-field" id="prof-email" value="${customer?.email || ''}"></div>
            </div>
            <div style="padding:0 16px;"><button class="btn btn-primary" onclick="updateProfile()">Save Profile</button></div>
            <div style="padding:20px 16px;">
                <button class="btn btn-danger" onclick="logout()">Log Out</button>
            </div>
            <div style="text-align:center; font-size:10px; color:#c7c7cc; padding:8px;">
                Customer ID: ${customer?.customer_id || 'N/A'}<br>
                Wallet ID: ${wallet?.wallet_id || 'N/A'}
            </div>
        </div>
    `;
}

async function updateProfile() {
    const name = document.getElementById('prof-name').value;
    const email = document.getElementById('prof-email').value;
    const res = await api('PUT', '/api/customer/profile', { name, email });
    if (res.success) { toast('✅ Profile updated'); customer.name = name; customer.email = email; saveState(); }
}

function logout() {
    token = ''; customer = null; wallet = null;
    localStorage.clear();
    toast('Logged out');
    navigate('login');
}

// ─── Init ───
if (token && customer) {
    connectSocket();
    navigate('home');
} else {
    navigate('login');
}
