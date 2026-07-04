import 'reflect-metadata';
import dataSource from '../database/data-source';
import { OrderDispatch, Rider, RiderEarning } from '../entities';

const riderId = 'f27491f7-965a-4072-999c-fd751ccbb9ee';

const deliveries = [
  {
    order_id: 'DUMMY-DEL-1001',
    status: 'delivered',
    pickup_address: 'Phoenix Marketcity, Kurla, Mumbai',
    dropoff_address: 'Bandra Kurla Complex, Mumbai',
    distance_km: 8.4,
    estimated_earnings: 18500,
    assigned_at: minutesAgo(92),
    picked_up_at: minutesAgo(74),
    in_transit_at: minutesAgo(66),
    delivered_at: minutesAgo(10),
    earning: {
      earning_type: 'delivery',
      base_fare: 12000,
      distance_bonus: 4500,
      surge_bonus: 2000,
      tip: 0,
      total: 18500,
      duration_minutes: 57,
      earned_at: minutesAgo(10),
    },
  },
  {
    order_id: 'DUMMY-DEL-1002',
    status: 'delivered',
    pickup_address: 'Andheri East Metro Station, Mumbai',
    dropoff_address: 'Powai Plaza, Mumbai',
    distance_km: 6.1,
    estimated_earnings: 14200,
    assigned_at: daysAgo(1, 110),
    picked_up_at: daysAgo(1, 92),
    in_transit_at: daysAgo(1, 84),
    delivered_at: daysAgo(1, 52),
    earning: {
      earning_type: 'delivery',
      base_fare: 10000,
      distance_bonus: 3200,
      surge_bonus: 0,
      tip: 1000,
      total: 14200,
      duration_minutes: 58,
      earned_at: daysAgo(1, 52),
    },
  },
  {
    order_id: 'DUMMY-DEL-1003',
    status: 'cancelled',
    pickup_address: 'Dadar West, Mumbai',
    dropoff_address: 'Lower Parel, Mumbai',
    distance_km: 4.7,
    estimated_earnings: 5000,
    assigned_at: daysAgo(2, 140),
    cancelled_at: daysAgo(2, 118),
    earning: {
      earning_type: 'cancellation_compensation',
      base_fare: 0,
      distance_bonus: 0,
      surge_bonus: 0,
      tip: 0,
      total: 5000,
      duration_minutes: 22,
      earned_at: daysAgo(2, 118),
    },
  },
];

async function main() {
  await dataSource.initialize();
  await dataSource.query('ALTER TABLE rider_earnings ALTER COLUMN earning_type TYPE VARCHAR(30)');

  const riders = dataSource.getRepository(Rider);
  const dispatches = dataSource.getRepository(OrderDispatch);
  const earnings = dataSource.getRepository(RiderEarning);

  const rider = await riders.findOneBy({ id: riderId });
  if (!rider) {
    throw new Error(`Rider not found: ${riderId}`);
  }

  for (const delivery of deliveries) {
    let dispatch = await dispatches.findOneBy({ order_id: delivery.order_id });
    dispatch = await dispatches.save({
      ...(dispatch || {}),
      order_id: delivery.order_id,
      status: delivery.status,
      city: 'Mumbai',
      pickup_lat: 19.076,
      pickup_lng: 72.8777,
      pickup_address: delivery.pickup_address,
      pickup_contact_name: 'Store Partner',
      pickup_contact_phone: '9000000001',
      dropoff_lat: 19.1076,
      dropoff_lng: 72.8376,
      dropoff_address: delivery.dropoff_address,
      dropoff_contact_name: 'Test Customer',
      dropoff_contact_phone: '9000000002',
      customer_id: `customer-${delivery.order_id.toLowerCase()}`,
      parcel_weight_kg: 2.5,
      requires_heavy_vehicle: false,
      special_notes: 'Dummy integration test delivery',
      assigned_rider_id: riderId,
      distance_km: delivery.distance_km,
      estimated_earnings: delivery.estimated_earnings,
      started_at: delivery.assigned_at,
      assigned_at: delivery.assigned_at,
      picked_up_at: delivery.picked_up_at,
      in_transit_at: delivery.in_transit_at,
      delivered_at: delivery.delivered_at,
      cancelled_at: delivery.cancelled_at,
    });

    let earning = await earnings.findOneBy({ order_id: delivery.order_id, rider_id: riderId });
    await earnings.save({
      ...(earning || {}),
      rider_id: riderId,
      order_id: delivery.order_id,
      dispatch_id: dispatch.id,
      distance_km: delivery.distance_km,
      ...delivery.earning,
    });
  }

  await riders.update(riderId, { total_deliveries: Math.max(rider.total_deliveries || 0, 2) });
  await dataSource.destroy();
  console.log(`Seeded ${deliveries.length} dummy deliveries and earnings for rider ${riderId}.`);
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function daysAgo(days: number, minutes: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 - minutes * 60 * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
