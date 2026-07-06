import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();
    
    // Log the actual error for debugging
    console.error('[ERROR]', {
      path: request.path,
      method: request.method,
      error: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined
    });

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : null;
    
    let error: any;
    if (typeof body === 'object' && body !== null) {
      error = body;
    } else {
      // Include detailed error message
      error = {
        code: status === 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR',
        message: String(body || 'Internal server error'),
        details: exception instanceof Error ? exception.message : undefined
      };
    }

    response.status(status).json({
      success: false,
      request_id: request.requestId,
      error
    });
  }
}
