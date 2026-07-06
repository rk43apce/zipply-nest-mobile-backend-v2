import { Body, Controller, Get, Param, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { RiderService } from './rider.service';

@UseGuards(AuthGuard('jwt'))
@Controller('rider')
export class RiderController {
  constructor(private readonly riders: RiderService) {}
  @Get('profile/:riderId') profile(@Param('riderId') id: string) { return this.riders.profile(id); }
  @Put('profile/:riderId') update(@Param('riderId') id: string, @Body() body: any) { return this.riders.updateProfile(id, body); }
  @Post('profile/complete') complete(@Req() req: any, @Body() body: any) { return this.riders.completeProfile(req.user.rider_id, body); }
  @Post('documents/upload') @UseInterceptors(FileInterceptor('file', { storage: diskStorage({ destination: './uploads', filename: (_r, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`) }), limits: { fileSize: 5 * 1024 * 1024 } }))
  upload(@Req() req: any, @Body('document_type') type: string, @UploadedFile() file: Express.Multer.File) { return this.riders.uploadDocument(req.user.rider_id, type, file); }
  @Post('documents/submit') submitDocs(@Req() req: any) { return this.riders.submitDocuments(req.user.rider_id); }
  @Get('documents/:riderId') docs(@Param('riderId') id: string) { return this.riders.documents(id); }
  @Post('background-check/initiate') bgStart(@Req() req: any) { return this.riders.initiateBackground(req.user.rider_id); }
  @Get('background-check/:riderId') bg(@Param('riderId') id: string) { return this.riders.background(id); }
  @Get('training/quiz/questions') questions() { return this.riders.quizQuestions(); }
  @Post('training/quiz/submit') submitQuiz(@Req() req: any, @Body() body: any) { return this.riders.submitQuiz(req.user.rider_id, body.answers); }
  @Get('training/:riderId') training(@Param('riderId') id: string) { return this.riders.training(id); }
  @Post('training/module/update') updateModule(@Req() req: any, @Body() body: any) { return this.riders.updateModule(req.user.rider_id, body.module_id, body.status); }
  @Post('bank/submit') bank(@Req() req: any, @Body() body: any) { return this.riders.submitBank(req.user.rider_id, body); }
  @Get('account-details') accountDetails(@Req() req: any, @Query('rider_id') riderId?: string) { return this.riders.accountDetails(riderId || req.user.rider_id); }
  @Post('device-token') deviceToken(@Req() req: any, @Body() body: any) { return this.riders.updateDeviceToken(req.user.rider_id, body); }
  @Post('activate') activate(@Req() req: any) { return this.riders.activate(req.user.rider_id); }
  @Get('onboarding/status/:riderId') onboarding(@Param('riderId') id: string) { return this.riders.onboardingStatus(id); }
}
