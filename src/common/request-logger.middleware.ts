import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { appendFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';

type LoggedRequest = Request & {
  requestId?: string;
  file?: {
    fieldname: string;
    originalname: string;
    mimetype: string;
    size: number;
    filename?: string;
    path?: string;
  };
};

function safePayload(value: unknown) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

export function requestLoggerMiddleware(logFilePath = './logs/api-requests.jsonl') {
  const resolvedPath = resolve(logFilePath);

  return (req: LoggedRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const originalJson = res.json.bind(res);
    let responsePayload: unknown = null;

    res.json = (body: unknown) => {
      responsePayload = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      const logRecord = {
        request_id: requestId,
        timestamp: new Date(startedAt).toISOString(),
        duration_ms: Date.now() - startedAt,
        method: req.method,
        path: req.originalUrl || req.url,
        status_code: res.statusCode,
        ip: req.ip,
        request: {
          query: safePayload(req.query),
          params: safePayload(req.params),
          body: safePayload(req.body),
          file: req.file
            ? {
                fieldname: req.file.fieldname,
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size,
                filename: req.file.filename,
                path: req.file.path
              }
            : null
        },
        response: safePayload(responsePayload)
      };

      mkdir(dirname(resolvedPath), { recursive: true })
        .then(() => appendFile(resolvedPath, JSON.stringify(logRecord) + '\n'))
        .catch((error) => {
          console.error(`Failed to write API log ${requestId}:`, error);
        });
    });

    next();
  };
}
