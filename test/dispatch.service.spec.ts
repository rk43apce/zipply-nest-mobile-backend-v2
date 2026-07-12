import { DispatchService } from '../src/dispatch/dispatch.service';

const activeDispatch = {
  id: 'dispatch-1',
  order_id: 'ORD-ACTIVE',
  status: 'arrived_pickup',
  assigned_rider_id: 'rider-1',
};

function createService(overrides: Record<string, any> = {}) {
  const redis = {
    hset: jest.fn(),
    hgetall: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  };
  const dispatches = {
    findOne: jest.fn(),
  };

  const service = new DispatchService(
    {} as any,
    dispatches as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    redis as any,
    {} as any,
    {} as any,
    {
      sendOrderOffer: jest.fn(),
      sendOfferCancelled: jest.fn(),
      sendOrderAssigned: jest.fn(),
    } as any,
    {} as any,
  );

  return {
    service: service as any,
    redis: { ...redis, ...overrides.redis },
    dispatches: { ...dispatches, ...overrides.dispatches },
  };
}

describe('DispatchService rider state reconciliation', () => {
  it('repairs stale Redis state from an active DB assignment', async () => {
    const { service, redis, dispatches } = createService();
    service.redis = redis;
    service.dispatches = dispatches;
    dispatches.findOne.mockResolvedValue(activeDispatch);

    const result = await service.reconcileRiderStatus('rider-1', {
      status: 'available',
      current_order_id: '',
      city: 'Delhi',
    });

    expect(result).toMatchObject({
      status: 'on_trip',
      current_order_id: 'ORD-ACTIVE',
      city: 'Delhi',
    });
    expect(redis.hset).toHaveBeenCalledWith(
      'rider:status:rider-1',
      expect.objectContaining({
        status: 'on_trip',
        current_order_id: 'ORD-ACTIVE',
      }),
    );
  });

  it('does not treat delivered assignments as active trips', async () => {
    const { service, redis, dispatches } = createService();
    service.redis = redis;
    service.dispatches = dispatches;
    dispatches.findOne.mockResolvedValue({
      ...activeDispatch,
      status: 'delivered',
    });
    redis.get.mockResolvedValue(null);

    const result = await service.reconcileRiderStatus('rider-1', {
      status: 'available',
      current_order_id: '',
    });

    expect(result).toMatchObject({
      status: 'available',
      current_order_id: '',
    });
    expect(redis.hset).not.toHaveBeenCalledWith(
      'rider:status:rider-1',
      expect.objectContaining({ status: 'on_trip' }),
    );
  });
});
