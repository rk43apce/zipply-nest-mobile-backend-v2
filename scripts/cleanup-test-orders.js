const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL || 'postgresql://vida:password@localhost:5433/vida_rider';
const pattern = process.env.CLEANUP_ORDER_PATTERN || 'ORD-%';

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN');

    const orders = await client.query(
      `
        SELECT order_id, hold_id
        FROM orders
        WHERE order_id LIKE $1
      `,
      [pattern]
    );
    const orderIds = orders.rows.map(row => row.order_id);

    if (!orderIds.length) {
      await client.query('COMMIT');
      console.log(`No test orders found for pattern ${pattern}`);
      return;
    }

    const activeHolds = await client.query(
      `
        SELECT wallet_id, SUM(amount)::int AS amount
        FROM wallet_holds
        WHERE reference_id = ANY($1) AND status = 'active'
        GROUP BY wallet_id
      `,
      [orderIds]
    );

    for (const hold of activeHolds.rows) {
      await client.query(
        `
          UPDATE wallets
          SET available_balance = available_balance + $1,
              version = version + 1,
              updated_at = NOW()
          WHERE id = $2
        `,
        [hold.amount, hold.wallet_id]
      );
    }

    const deleted = {};
    deleted.dispatch_events = (await client.query('DELETE FROM dispatch_events WHERE order_id = ANY($1)', [orderIds])).rowCount;
    deleted.dispatch_offers = (await client.query('DELETE FROM dispatch_offers WHERE order_id = ANY($1)', [orderIds])).rowCount;
    deleted.rider_earnings = (await client.query('DELETE FROM rider_earnings WHERE order_id = ANY($1)', [orderIds])).rowCount;
    deleted.order_dispatches = (await client.query('DELETE FROM order_dispatches WHERE order_id = ANY($1)', [orderIds])).rowCount;
    deleted.order_events = (await client.query('DELETE FROM order_events WHERE order_id = ANY($1)', [orderIds])).rowCount;
    deleted.order_ratings = (await client.query('DELETE FROM order_ratings WHERE order_id = ANY($1)', [orderIds])).rowCount;
    deleted.orders = (await client.query('DELETE FROM orders WHERE order_id = ANY($1)', [orderIds])).rowCount;
    deleted.wallet_holds = (await client.query('DELETE FROM wallet_holds WHERE reference_id = ANY($1)', [orderIds])).rowCount;
    deleted.wallet_transactions = (await client.query('DELETE FROM wallet_transactions WHERE reference_id = ANY($1)', [orderIds])).rowCount;

    await client.query('COMMIT');
    console.log(JSON.stringify({ pattern, order_count: orderIds.length, released_holds: activeHolds.rows, deleted }, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
