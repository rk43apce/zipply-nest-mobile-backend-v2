import { EarningsService } from '../src/earnings/earnings.service';

function createService() {
  return new EarningsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  ) as any;
}

describe('EarningsService IST day windows', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts today at midnight Asia/Kolkata, represented as the previous UTC evening', () => {
    jest.setSystemTime(new Date('2026-07-05T03:00:00.000Z'));
    const service = createService();

    expect(service.startOfDay(0).toISOString()).toBe('2026-07-04T18:30:00.000Z');
    expect(service.endOfDay(0).toISOString()).toBe('2026-07-05T18:29:59.999Z');
  });

  it('returns stable IST ISO date labels for daily earnings buckets', () => {
    const service = createService();

    expect(service.istIsoDate(new Date('2026-07-04T18:30:00.000Z'))).toBe('2026-07-05');
    expect(service.istIsoDate(new Date('2026-07-04T18:29:59.999Z'))).toBe('2026-07-04');
  });
});
