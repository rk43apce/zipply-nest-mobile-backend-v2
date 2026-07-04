import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, extra: Record<string, unknown> = {}) {
    super({ code, message, ...extra }, status);
  }
}
