#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const collectionPath = path.join(root, 'vida-customer-api.postman_collection.json');
const environmentPath = path.join(root, 'vida-customer-local.postman_environment.json');

const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
const environment = JSON.parse(fs.readFileSync(environmentPath, 'utf8'));
const env = Object.fromEntries(environment.values.filter(v => v.enabled !== false).map(v => [v.key, v.value]));

const state = {
  baseUrl: process.env.BASE_URL || env.base_url || 'http://localhost:3000',
  mobile: process.env.CUSTOMER_MOBILE || env.customer_mobile || '9871234567',
  otp: process.env.OTP || env.otp || '1234',
  token: process.env.CUSTOMER_ACCESS_TOKEN || env.customer_access_token || '',
  refreshToken: process.env.CUSTOMER_REFRESH_TOKEN || env.customer_refresh_token || '',
  customerId: env.customer_id || '',
  walletId: env.wallet_id || '',
  paymentTxnId: env.payment_txn_id || '',
  orderId: env.order_id || '',
  addressId: env.address_id || '',
  idempotencyKey: process.env.IDEMPOTENCY_KEY || `topup_dev_${Date.now()}`
};

const results = [];

function log(title) {
  console.log(`\n=== ${title} ===`);
}

function saveEnv() {
  const updates = {
    customer_access_token: state.token,
    customer_refresh_token: state.refreshToken,
    customer_id: state.customerId,
    wallet_id: state.walletId,
    payment_txn_id: state.paymentTxnId,
    order_id: state.orderId,
    address_id: state.addressId,
    idempotency_key: state.idempotencyKey
  };
  for (const item of environment.values) {
    if (Object.prototype.hasOwnProperty.call(updates, item.key)) item.value = updates[item.key] || '';
  }
  fs.writeFileSync(environmentPath, JSON.stringify(environment, null, 2));
}

async function request(name, method, url, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
  const started = Date.now();
  let response;
  let json;
  try {
    response = await fetch(`${state.baseUrl}${url}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    json = text ? JSON.parse(text) : {};
  } catch (err) {
    results.push({ name, ok: false, status: 'NETWORK', ms: Date.now() - started });
    console.error(`FAIL ${name}: ${err.message}`);
    throw err;
  }
  const ok = opts.allowStatuses ? opts.allowStatuses.includes(response.status) : response.ok;
  results.push({ name, ok, status: response.status, ms: Date.now() - started });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} [${response.status}] ${Date.now() - started}ms`);
  if (!ok) {
    console.log(JSON.stringify(json, null, 2));
    throw new Error(`${name} failed with ${response.status}`);
  }
  return json;
}

async function run() {
  console.log(`Collection: ${collection.info.name}`);
  console.log(`Base URL: ${state.baseUrl}`);
  console.log(`Mobile: ${state.mobile}`);

  log('Customer Auth');
  await request('Send OTP', 'POST', '/api/customer/otp/send', { mobile: state.mobile }, { auth: false });
  const verify = await request('Verify OTP', 'POST', '/api/customer/otp/verify', { mobile: state.mobile, otp: state.otp }, { auth: false });
  state.token = verify.data.access_token;
  state.refreshToken = verify.data.refresh_token;
  state.customerId = verify.data.customer.customer_id;
  state.walletId = verify.data.wallet.wallet_id;
  console.log(`customer_id=${state.customerId}`);
  console.log(`wallet_id=${state.walletId}`);

  log('Profile And Address');
  await request('Get Profile', 'GET', '/api/customer/profile');
  await request('Update Profile', 'PUT', '/api/customer/profile', { name: 'Priya Sharma', email: 'priya@example.com' });
  const address = await request('Create Address', 'POST', '/api/customer/addresses', {
    label: 'Home',
    address: '14B, Juhu Scheme, Mumbai',
    lat: 19.0728,
    lng: 72.8826,
    contact_name: 'Priya Sharma',
    contact_phone: '9871234567',
    is_default: true
  });
  state.addressId = address.data.id;
  await request('List Addresses', 'GET', '/api/customer/addresses');

  log('Wallet');
  await request('Get Wallet', 'GET', `/api/wallet/${state.walletId}`);
  await request('Get Wallet Limits', 'GET', `/api/wallet/${state.walletId}/limits`);
  const topup = await request('Initiate Topup', 'POST', '/api/wallet/topup/initiate', {
    wallet_id: state.walletId,
    amount: 50000,
    idempotency_key: state.idempotencyKey
  });
  state.paymentTxnId = topup.data.payment_txn_id;
  await request('Confirm Topup', 'POST', '/api/wallet/topup/confirm', { payment_txn_id: state.paymentTxnId });
  await request('Get Topup', 'GET', `/api/wallet/topup/${state.paymentTxnId}`);
  await request('Wallet Transactions', 'GET', `/api/wallet/${state.walletId}/transactions?page=1&limit=20`);

  log('Orders');
  await request('Estimate Order', 'POST', '/api/orders/estimate', {
    pickup: { lat: 19.0596, lng: 72.8295 },
    dropoff: { lat: 19.0728, lng: 72.8826 },
    parcel: { weight_kg: 2.5 }
  }, { auth: false });

  const order = await request('Create Order - Wallet', 'POST', '/api/orders/create', {
    pickup: { lat: 19.0596, lng: 72.8295, address: 'Cafe Coffee Day, Bandra West, Mumbai', contact_name: 'Store Manager', contact_phone: '9876543210' },
    dropoff: { lat: 19.0728, lng: 72.8826, address: '14B, Juhu Scheme, Mumbai', contact_name: 'Priya Sharma', contact_phone: '9871234567' },
    parcel: { weight_kg: 2.5, special_notes: 'Handle with care' },
    payment_method: 'wallet'
  });
  state.orderId = order.data.order_id;
  console.log(`order_id=${state.orderId}`);
  await request('Get Order', 'GET', `/api/orders/${state.orderId}`);
  await request('Get Order Status', 'GET', `/api/orders/${state.orderId}/status`);
  await request('Get Order Timeline', 'GET', `/api/orders/${state.orderId}/timeline`);
  await request('List Orders', 'GET', '/api/orders?page=1&limit=20');

  if (process.env.SIMULATE_CANCEL !== 'false') {
    await request('Cancel Order', 'POST', `/api/orders/${state.orderId}/cancel`, { reason: 'Simulator cleanup' });
  }

  if (process.env.SIMULATE_ALL_PAYMENT_METHODS === 'true') {
    await createOrderWithPayment('cash');
    const onlineId = await createOrderWithPayment('online');
    await request('Confirm Online Payment', 'POST', `/api/orders/${onlineId}/online/confirm`);
  }

  saveEnv();
  summary();
}

async function createOrderWithPayment(paymentMethod) {
  const res = await request(`Create Order - ${paymentMethod}`, 'POST', '/api/orders/create', {
    pickup: { lat: 19.0596, lng: 72.8295, address: 'Cafe Coffee Day, Bandra West, Mumbai', contact_name: 'Store Manager', contact_phone: '9876543210' },
    dropoff: { lat: 19.0728, lng: 72.8826, address: '14B, Juhu Scheme, Mumbai', contact_name: 'Priya Sharma', contact_phone: '9871234567' },
    parcel: { weight_kg: 2.5, special_notes: 'Handle with care' },
    payment_method: paymentMethod
  });
  return res.data.order_id;
}

function summary() {
  const failed = results.filter(r => !r.ok);
  console.log('\n=== Summary ===');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} (${r.status}, ${r.ms}ms)`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

run().catch(err => {
  saveEnv();
  summary();
  console.error(`\nSimulator stopped: ${err.message}`);
  process.exit(1);
});
