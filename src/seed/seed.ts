import 'reflect-metadata';
import Redis from 'ioredis';
import dataSource from '../database/data-source';
import { QuizQuestion, Rider, TrainingProgress } from '../entities';

const quiz = [
  ['What should you do if the parcel is oversized for your vehicle?', ['Deliver it anyway', "Cancel with reason 'oversized'", 'Leave without informing', 'Contact customer directly'], 1],
  ['How often should you send GPS updates while online?', ['Every 30 seconds', 'Every 5 seconds', 'Every minute', 'Only when delivering'], 1],
  ["What happens if you don't respond to an offer in 30 seconds?", ['Nothing happens', "It's auto-rejected and goes to next rider", 'Your account gets blocked', 'You pay a penalty'], 1],
  ['When can a customer cancel their order for free?', ['Anytime', 'Before rider is assigned', 'After delivery', 'Never'], 1],
  ['What does a red dot on the map represent?', ['Pickup location', 'Dropoff location', 'Your location', 'Another rider'], 1],
  ['If the store is closed when you arrive, what should you do?', ['Wait 30 minutes', "Cancel with reason 'store_closed'", 'Deliver from another store', 'Call the admin'], 1],
  ['What is the minimum rating to stay active on the platform?', ['3.0', '3.5', '4.0', '4.5'], 2],
  ["How long do you wait at pickup before you can cancel for 'long_wait'?", ['5 minutes', '10 minutes', '15 minutes', '30 minutes'], 1],
  ["What does 'SETNX' in the dispatch system prevent?", ['Slow delivery', 'Double assignment of same order', 'GPS errors', 'Payment fraud'], 1],
  ['After marking delivered, your status becomes:', ['offline', 'on_trip', 'available', 'busy'], 2]
];

const names = ['Rajesh Kumar', 'Amit Patel', 'Suresh Yadav', 'Vikram Singh', 'Deepak Sharma', 'Rahul Verma', 'Manoj Tiwari', 'Karan Malhotra', 'Arun Nair', 'Pradeep Joshi', 'Sachin More', 'Nitin Deshmukh', 'Ravi Gupta', 'Sanjay Mishra', 'Ajay Chauhan'];

async function main() {
  await dataSource.initialize();
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const riders = dataSource.getRepository(Rider);
  const questions = dataSource.getRepository(QuizQuestion);
  const progress = dataSource.getRepository(TrainingProgress);
  await questions.clear();
  await questions.save(quiz.map(([question, options, correct_option]) => ({ question, options, correct_option, is_active: true } as any)));
  for (let i = 0; i < names.length; i++) {
    const mobile = `98765432${String(i).padStart(2, '0')}`;
    let rider = await riders.findOneBy({ mobile });
    rider = await riders.save({ ...(rider || {}), mobile, name: names[i], date_of_birth: '1995-01-01', gender: 'male', city: 'Mumbai', vehicle_type: i % 3 === 0 ? 'scooter' : 'bike', max_parcel_weight_kg: i % 4 === 0 ? 20 : 10, onboarding_status: 'activated', activated_at: new Date(), rating: 4.8, total_deliveries: 20 + i });
    const lat = 19.05 + i * 0.002;
    const lng = 72.81 + i * 0.004;
    await redis.geoadd('riders:online:Mumbai', lng, lat, rider.id);
    await redis.hset(`rider:status:${rider.id}`, { status: 'available', city: 'Mumbai', lat, lng, last_seen: new Date().toISOString(), online_since: new Date().toISOString(), vehicle_type: rider.vehicle_type, max_parcel_weight_kg: rider.max_parcel_weight_kg });
    if (i < 2) {
      for (const module_id of ['app_navigation', 'order_acceptance', 'pickup_delivery']) await progress.upsert({ rider_id: rider.id, module_id, status: 'completed', completed_at: new Date() }, ['rider_id', 'module_id']);
    }
  }
  await redis.quit();
  await dataSource.destroy();
  console.log('Seeded riders, Redis GEO positions, quiz questions, and sample training progress.');
}

main().catch((err) => { console.error(err); process.exit(1); });
