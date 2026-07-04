import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : null;
    const error = typeof body === 'object' && body !== null
      ? body
      : { code: status === 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR', message: String(body || 'Internal server error') };
    response.status(status).json({ success: false, request_id: request.requestId, error });
  }
}
