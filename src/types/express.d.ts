declare global {
  namespace Express {
    interface User {
      rider_id: string;
      mobile: string;
      onboarding_status: string;
    }
  }
}
