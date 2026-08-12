import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import config from './config/index.js';
import apiRoutes from './routes/index.js';
import notFound from './middleware/notFound.js';
import errorHandler from './middleware/errorHandler.js';
import ApiError from './utils/ApiError.js';

export function createApp() {
  const app = express();

  // Trust the first proxy so secure cookies and req.ip work behind nginx/Heroku.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());

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
  app.use(cookieParser());

  if (!config.isProduction) {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined'));
  }

  /**
   * State-changing requests must be JSON. Combined with SameSite=Strict cookies,
   * this blocks classic form-based CSRF, which can only send urlencoded /
   * multipart / text-plain bodies.
   */
  app.use((req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const contentType = req.headers['content-type'] || '';
      const hasBody = req.headers['content-length'] && req.headers['content-length'] !== '0';
      if (hasBody && !contentType.includes('application/json')) {
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
