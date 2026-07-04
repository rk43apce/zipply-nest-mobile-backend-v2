import Redis from 'ioredis';

/**
 * Script to check if a rider is ready to accept orders
 * 
 * Checks:
 * - Rider is online (Redis status)
 * - No pending offers waiting
 * - No active orders
 * - Weight capacity sufficient
 * - Last location update recent
 * 
 * Usage: npx ts-node scripts/check-rider-readiness.ts <rider_id>
 * Example: npx ts-node scripts/check-rider-readiness.ts 1c5eef51-a2b8-448e-b6b5-96f53c7d01dc
 */

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  db: 0,
  retryStrategy: () => null, // Don't retry if Redis is down
});

async function checkRiderReadiness(riderId: string) {
  try {
    console.log(`\n📋 Checking readiness for rider: ${riderId}\n`);

    // 1. Check rider status in Redis
    console.log('1️⃣  Checking rider online status...');
    const riderStatus = await redis.hgetall(`rider:status:${riderId}`);
    
    if (!riderStatus || Object.keys(riderStatus).length === 0) {
      console.log('❌ Rider status not found in Redis');
      console.log('   Status: OFFLINE');
      console.log('\n   Action required: Rider needs to come online');
      console.log('─'.repeat(60) + '\n');
      await redis.quit();
      return;
    }

    const status = riderStatus.status || 'unknown';
    const city = riderStatus.city || 'N/A';
    const lat = Number(riderStatus.lat || 0);
    const lng = Number(riderStatus.lng || 0);
    const maxWeight = Number(riderStatus.max_parcel_weight_kg || 0);
    const vehicleType = riderStatus.vehicle_type || 'N/A';
    const lastSeen = riderStatus.last_seen ? new Date(riderStatus.last_seen) : null;
    const onlineSince = riderStatus.online_since ? new Date(riderStatus.online_since) : null;

    console.log(`   ✅ Rider found in Redis`);
    console.log(`   Status: ${status}`);
    console.log(`   City: ${city}`);
    console.log(`   Vehicle: ${vehicleType}`);
    console.log(`   Location: (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
    console.log(`   Max weight: ${maxWeight} kg`);

    if (lastSeen) {
      const secondsAgo = Math.round((Date.now() - lastSeen.getTime()) / 1000);
      console.log(`   Last activity: ${secondsAgo} seconds ago`);
    }

    if (onlineSince) {
      const minutesOnline = Math.round((Date.now() - onlineSince.getTime()) / 60000);
      console.log(`   Online for: ${minutesOnline} minutes`);
    }

    // 2. Check if rider is in online set
    console.log('\n2️⃣  Checking online pool status...');
    const inOnlineSet = await redis.zscore('riders:online', riderId);
    if (inOnlineSet !== null) {
      console.log('   ✅ Rider is in global online pool');
    } else {
      console.log('   ❌ Rider is NOT in global online pool');
    }

    // 3. Check city-specific online set
    if (city && city !== 'N/A') {
      const inCitySet = await redis.zscore(`riders:online:${city}`, riderId);
      if (inCitySet !== null) {
        console.log(`   ✅ Rider is in ${city} online pool`);
      } else {
        console.log(`   ❌ Rider is NOT in ${city} online pool`);
      }
    }

    // 4. Check if rider has pending offer
    console.log('\n3️⃣  Checking for pending offers...');
    const pendingOfferId = await redis.get(`rider:offered:${riderId}`);
    if (pendingOfferId) {
      console.log(`   ⚠️  Rider has pending offer: ${pendingOfferId}`);
      const offerTimer = await redis.get(`offer:timer:${pendingOfferId}`);
      if (offerTimer === riderId) {
        const ttl = await redis.ttl(`offer:timer:${pendingOfferId}`);
        if (ttl > 0) {
          console.log(`   Expires in: ${ttl} seconds`);
        }
      }
      console.log('   Action: Rider must respond to this offer first (accept/reject)');
    } else {
      console.log('   ✅ No pending offers');
    }

    // 5. Check if rider has active order
    console.log('\n4️⃣  Checking for active orders...');
    if (riderStatus.current_order_id && riderStatus.current_order_id !== '') {
      console.log(`   ⚠️  Rider is on active order: ${riderStatus.current_order_id}`);
      console.log('   Action: Rider must complete this delivery first');
    } else {
      console.log('   ✅ No active orders');
    }

    // 6. Readiness assessment
    console.log('\n5️⃣  Readiness assessment...');
    
    const checks = {
      'Status is available': status === 'available',
      'No pending offers': !pendingOfferId,
      'No active orders': !riderStatus.current_order_id,
      'In online pool': inOnlineSet !== null,
      'Weight capacity sufficient': maxWeight >= 2.5,
      'Recently active': !lastSeen || (Date.now() - lastSeen.getTime()) < 5 * 60000,
    };

    Object.entries(checks).forEach(([check, passed]) => {
      console.log(`   ${passed ? '✅' : '❌'} ${check}`);
    });

    // 7. Final verdict
    console.log('\n📊 READINESS VERDICT:');
    console.log('─'.repeat(60));

    const isReady = Object.values(checks).every(v => v);

    if (isReady) {
      console.log('\n✅ ✅ ✅  RIDER IS READY TO ACCEPT ORDERS  ✅ ✅ ✅\n');
      console.log('   Summary:');
      console.log(`   • Status: ${status} (available)`);
      console.log(`   • Location: ${city}`);
      console.log(`   • Can carry: up to ${maxWeight} kg`);
      console.log(`   • No obstacles blocking offers`);
      console.log(`   • Ready to receive new order offers\n`);
    } else {
      console.log('\n❌ RIDER IS NOT READY\n');
      console.log('   Issues preventing order acceptance:');
      Object.entries(checks).forEach(([check, passed]) => {
        if (!passed) {
          console.log(`   ❌ ${check}`);
        }
      });
      console.log();
    }

    console.log('─'.repeat(60) + '\n');

  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      console.error('❌ Cannot connect to Redis');
      console.error(`   Make sure Redis is running on ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`);
    } else {
      console.error('❌ Error checking rider readiness:', error);
    }
  } finally {
    await redis.quit();
  }
}

// Main execution
const riderId = process.argv[2];

if (!riderId) {
  console.log('\nUsage: npx ts-node scripts/check-rider-readiness.ts <rider_id>\n');
  console.log('Example:');
  console.log('  npx ts-node scripts/check-rider-readiness.ts 1c5eef51-a2b8-448e-b6b5-96f53c7d01dc\n');
  console.log('Environment variables:');
  console.log('  REDIS_HOST (default: localhost)');
  console.log('  REDIS_PORT (default: 6379)\n');
  process.exit(1);
}

checkRiderReadiness(riderId).catch(console.error).finally(() => process.exit(0));
