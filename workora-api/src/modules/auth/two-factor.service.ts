import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { toString as qrSvg } from 'qrcode';
import { DataSource } from 'typeorm';
import { AuthPrincipal } from '../../common/auth/principal';
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from '../../common/auth/totp';
import { SecretBox } from '../../common/crypto/secret-box';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { EmailService } from '../email/email.module';
import { Organization } from '../organizations/organization.entity';
import { User } from '../users/user.entity';

const SECRET_FIELDS = { id: true, email: true, name: true, passwordHash: true, totpSecret: true, totpPendingSecret: true, totpEnabledAt: true, totpLastStep: true, recoveryCodes: true } as const;

/** TOTP two-factor authentication: setup with QR code, verification, recovery codes. */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly box: SecretBox,
    private readonly email: EmailService,
    private readonly events: EventBus,
  ) {}

  private load(userId: string) {
    return this.dataSource.getRepository(User).findOneOrFail({ where: { id: userId }, select: SECRET_FIELDS });
  }

  async status(u: AuthPrincipal) {
    const user = await this.load(u.userId);
    const org = await this.dataSource.getRepository(Organization).findOneByOrFail({ id: u.organizationId });
    return { enabled: !!user.totpEnabledAt, enabledAt: user.totpEnabledAt, recoveryCodesLeft: user.recoveryCodes.length, requiredByWorkspace: org.require2fa, signedInWith: u.amr ?? 'pwd' };
  }

  /** Step 1: a fresh secret (kept pending until confirmed) with a QR code for the authenticator app. */
  async setup(u: AuthPrincipal) {
    const user = await this.load(u.userId);
    if (user.totpEnabledAt) throw ApiException.conflict('MFA_ALREADY_ENABLED', 'Two-factor authentication is already on');
    const secret = newTotpSecret();
    await this.dataSource.getRepository(User).update({ id: user.id }, { totpPendingSecret: this.box.seal(secret) });
    const url = otpauthUrl(secret, user.email);
    return { secret, otpauthUrl: url, qrSvg: await qrSvg(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }) };
  }

  /** Step 2: the first valid code turns 2FA on and returns recovery codes (shown once). */
  async enable(u: AuthPrincipal, code: string) {
    const user = await this.load(u.userId);
    if (user.totpEnabledAt) throw ApiException.conflict('MFA_ALREADY_ENABLED', 'Two-factor authentication is already on');
    if (!user.totpPendingSecret) throw ApiException.badRequest('MFA_SETUP_MISSING', 'Start setup first');
    const secret = this.box.open(user.totpPendingSecret);
    const step = verifyTotp(secret, code);
    if (step === null) throw ApiException.badRequest('INVALID_CODE', 'That code is not valid. Check the time on your phone and try the newest code.');
    const codes = newRecoveryCodes();
    await this.dataSource.getRepository(User).update(
      { id: user.id },
      { totpSecret: user.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: String(step), recoveryCodes: codes.map(hashRecoveryCode) },
    );
    await this.notify(user, 'Two-factor authentication is on', 'You turned on two-factor authentication. Signing in now needs a code from your authenticator app.');
    return { enabled: true, recoveryCodes: codes };
  }

  async disable(u: AuthPrincipal, password: string, code: string) {
    const user = await this.load(u.userId);
    if (!user.totpEnabledAt) throw ApiException.badRequest('MFA_NOT_ENABLED', 'Two-factor authentication is off');
    const org = await this.dataSource.getRepository(Organization).findOneByOrFail({ id: u.organizationId });
    if (org.require2fa) throw ApiException.forbidden('Your workspace requires two-factor authentication');
    if (!(await bcrypt.compare(password ?? '', user.passwordHash))) throw new ApiException(401, 'INVALID_CREDENTIALS', 'Password is incorrect');
    if (!(await this.check(user, code))) throw ApiException.badRequest('INVALID_CODE', 'That code is not valid');
    await this.dataSource.getRepository(User).update({ id: user.id }, { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] });
    await this.notify(user, 'Two-factor authentication is off', 'You turned off two-factor authentication. Signing in now only needs your password.');
    return { enabled: false };
  }

  async regenerateRecoveryCodes(u: AuthPrincipal, code: string) {
    const user = await this.load(u.userId);
    if (!user.totpEnabledAt) throw ApiException.badRequest('MFA_NOT_ENABLED', 'Two-factor authentication is off');
    if (!(await this.check(user, code, false))) throw ApiException.badRequest('INVALID_CODE', 'That code is not valid');
    const codes = newRecoveryCodes();
    await this.dataSource.getRepository(User).update({ id: user.id }, { recoveryCodes: codes.map(hashRecoveryCode) });
    return { recoveryCodes: codes };
  }

  /** Verifies a sign-in code for a user (TOTP, or a single-use recovery code). */
  async verifyForLogin(userId: string, code: string) {
    const user = await this.load(userId);
    if (!user.totpEnabledAt) return false;
    return this.check(user, code);
  }

  /** Security email plus an in-app and desktop notification. */
  private async notify(user: User, title: string, body: string) {
    this.events.securityNotice({ userId: user.id, title, body });
    await this.email.securityNotice(user, title, body);
  }

  /** TOTP codes advance the replay guard; recovery codes are burned on use. */
  private async check(user: User, code: string, allowRecovery = true) {
    const input = String(code ?? '').trim();
    if (/^\d{3}\s?\d{3}$/.test(input)) {
      const step = verifyTotp(this.box.open(user.totpSecret!), input, user.totpLastStep === null ? null : Number(user.totpLastStep));
      if (step === null) return false;
      // Conditional update: two concurrent requests with the same code can't both succeed.
      const [, n] = await this.dataSource.query(`UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`, [user.id, step]);
      return n === 1;
    }
    if (!allowRecovery) return false;
    const hash = hashRecoveryCode(input);
    const [, n] = await this.dataSource.query(`UPDATE users SET recovery_codes = recovery_codes - $2 WHERE id = $1 AND recovery_codes ? $2`, [user.id, hash]);
    if (n !== 1) return false;
    const left = user.recoveryCodes.length - 1;
    await this.notify(user, 'A recovery code was used', `Someone signed in to your account with a recovery code. ${left} ${left === 1 ? 'code remains' : 'codes remain'}.`);
    return true;
  }
}
