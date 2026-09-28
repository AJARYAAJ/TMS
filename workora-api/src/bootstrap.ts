import { INestApplication, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, raw, urlencoded } from 'express';
import { AppConfig } from './config';
import { validationPipe } from './common/http/validation';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

/** Shared HTTP pipeline for the server and the e2e tests. */
export async function configureApp(app: INestApplication, config: AppConfig) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', 1);
  // Signed-URL uploads carry raw bytes of any content type; everything else is JSON.
  express.use('/api/v1/storage', raw({ type: () => true, limit: config.maxUploadBytes }));
  express.use(json({ limit: '1mb' }));
  express.use(urlencoded({ extended: true, limit: '1mb' }));

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(validationPipe);
  app.enableCors({ origin: config.corsOrigins, credentials: true, exposedHeaders: ['Retry-After'] });
  app.enableShutdownHooks();

  if (config.realtimeRedisAdapter) {
    const adapter = new RedisIoAdapter(app, config.redisUrl);
    await adapter.connect();
    app.useWebSocketAdapter(adapter);
  }

  const doc = new DocumentBuilder()
    .setTitle('Workora API')
    .setDescription('API-first, real-time, multi-tenant work & project operations platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc));
  return app;
}
