import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig, loadConfig } from '../config';
import { TokenService } from './auth/token.service';
import { EventBus } from './events/event-bus.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const c = loadConfig();
        return { secret: c.jwtSecret, signOptions: { expiresIn: c.jwtTtl as any } };
      },
    }),
  ],
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() }, TokenService, EventBus],
  exports: [APP_CONFIG, TokenService, EventBus, JwtModule],
})
export class CommonModule {}
