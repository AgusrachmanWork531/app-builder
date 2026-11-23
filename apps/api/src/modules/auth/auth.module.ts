import type { ApiEnv } from '@aab/shared-config';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from '../../common/auth/auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({})
export class AuthModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: AuthModule,
      imports: [JwtModule.register({ secret: env.JWT_SECRET })],
      controllers: [AuthController],
      providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
    };
  }
}
