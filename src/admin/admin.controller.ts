import { Controller, Get } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('api/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('live-riders')
  async getLiveRiders() {
    const data = await this.adminService.getLiveRiders();
    return { success: true, ...data };
  }
}
