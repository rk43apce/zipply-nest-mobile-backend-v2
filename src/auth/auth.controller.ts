import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('otp/send') send(@Body() body: { mobile: string }) { return this.auth.sendOtp(body.mobile); }
  @Post('otp/verify') verify(@Body() body: { mobile: string; otp: string; device_id?: string; device_meta?: Record<string, any> }) { return this.auth.verifyOtp(body.mobile, body.otp, body.device_id, body.device_meta); }
  @Post('token/refresh') refresh(@Body() body: { refresh_token: string }) { return this.auth.refresh(body.refresh_token); }
  @Post('logout') logout(@Body() body: { rider_id: string }) { return this.auth.logout(body.rider_id); }
}
