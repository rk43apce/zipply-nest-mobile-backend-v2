import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('otp/send') send(@Body() body: { mobile: string }) { return this.auth.sendOtp(body.mobile); }
  @Post('otp/verify') verify(@Body() body: { mobile: string; otp: string }) { return this.auth.verifyOtp(body.mobile, body.otp); }
  @Post('token/refresh') refresh(@Body() body: { refresh_token: string }) { return this.auth.refresh(body.refresh_token); }
}
