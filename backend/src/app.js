import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import config from './config/env.js';
import apiRoutes from './routes/index.js';
import { requestMetrics } from './middleware/observability.js';
import notFound from './middleware/notFound.js';
import errorHandler from './middleware/errorHandler.js';
import requestId from './middleware/requestId.js';
import ApiError from './utils/ApiError.js';

export function createApp() {
  const app = express();

  // Trust the first proxy so secure cookies and req.ip work behind nginx/Heroku.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  // Times every request and buckets it by normalised route (D6).
  app.use(requestMetrics);

  // JSON API — no HTML to lock down. HSTS only when we are actually on HTTPS.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin/non-browser callers (curl, Postman) which send no Origin.
        if (!origin) return callback(null, true);
        if (config.clientOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true, // required for the httpOnly auth cookies
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(express.text({ type: ['text/plain', 'application/hl7-v2', 'x-application/hl7-v2+er7'], limit: '1mb' }));
  app.use(cookieParser());

  morgan.token('id', (req) => req.id || '-');
  if (!config.isProduction) {
    app.use(morgan(':id :method :url :status :response-time ms'));
  } else {
    app.use(morgan(':id :remote-addr :method :url :status :response-time ms'));
  }

  /**
   * The ONLY endpoints permitted to accept multipart/form-data.
   *
   * Kept to an explicit list because multipart is one of the three encodings a
   * plain HTML form can send, so every path allowed here is a path where the
   * JSON requirement below stops contributing to CSRF defence. Uploading
   * radiology images genuinely needs it; nothing else does.
   */
  const MULTIPART_ROUTES = [
    { method: 'POST', pattern: /^\/api\/v1\/radiology\/orders\/[0-9a-fA-F]{24}\/attachments\/?$/ },
    { method: 'POST', pattern: /^\/api\/v1\/dicom\/studies\/?$/ },
  ];

  const TEXT_PLAIN_ROUTES = [
    { method: 'POST', pattern: /^\/api\/v1\/lab\/inbound\/hl7\/?$/ },
  ];

  /**
   * State-changing requests must be JSON. Combined with SameSite=Strict cookies,
   * this blocks classic form-based CSRF, which can only send urlencoded /
   * multipart / text-plain bodies.
   */
  app.use((req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const contentType = req.headers['content-type'] || '';
      const hasBody = req.headers['content-length'] && req.headers['content-length'] !== '0';

      const multipartAllowed =
        contentType.includes('multipart/form-data') &&
        MULTIPART_ROUTES.some(
          (route) => route.method === req.method && route.pattern.test(req.path),
        );

      const textAllowed =
        (contentType.includes('text/plain') || contentType.includes('hl7')) &&
        TEXT_PLAIN_ROUTES.some(
          (route) => route.method === req.method && route.pattern.test(req.path),
        );

      if (hasBody && !contentType.includes('application/json') && !multipartAllowed && !textAllowed) {
        return next(
          ApiError.badRequest('Content-Type must be application/json', {
            code: 'UNSUPPORTED_CONTENT_TYPE',
          }),
        );
      }
    }
    return next();
  });

  app.use('/api/v1', apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
