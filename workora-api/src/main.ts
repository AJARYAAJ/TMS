import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  await configureApp(app, config);
  await app.listen(config.port);
  Logger.log(`Workora API listening on http://localhost:${config.port}/api/v1 (docs: /api/docs)`, 'Bootstrap');
}

bootstrap();
