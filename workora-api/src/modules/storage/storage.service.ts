import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { APP_CONFIG, AppConfig } from '../../config';
import { ApiException } from '../../common/http/api-exception';

export type StorageOp = 'put' | 'get';

/**
 * Object storage behind signed URLs. The browser uploads/downloads directly against a
 * short-lived signed URL rather than streaming files through the JSON API.
 *
 * This implementation stores objects on local disk and serves them from /api/v1/storage.
 * An S3/GCS implementation only needs to return that provider's presigned URLs instead.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.root = resolve(config.storageRoot);
  }

  newKey(organizationId: string) {
    return `${organizationId}/${randomUUID()}`;
  }

  signedUrl(op: StorageOp, key: string, extra: Record<string, string> = {}) {
    const expires = Math.floor(Date.now() / 1000) + this.config.storageUrlTtlSeconds;
    const params = new URLSearchParams({ ...extra, op, exp: String(expires) });
    params.set('sig', this.sign(op, key, expires, extra));
    return { url: `/api/v1/storage/${key}?${params.toString()}`, expiresAt: new Date(expires * 1000).toISOString() };
  }

  verify(op: StorageOp, key: string, expires: number, sig: string, extra: Record<string, string> = {}) {
    if (!Number.isFinite(expires) || expires < Date.now() / 1000) throw new ApiException(403, 'URL_EXPIRED', 'This link has expired');
    const expected = Buffer.from(this.sign(op, key, expires, extra));
    const given = Buffer.from(sig ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ApiException(403, 'INVALID_SIGNATURE', 'Invalid signature');
  }

  async write(key: string, body: Readable, maxBytes = this.config.maxUploadBytes) {
    const path = this.pathFor(key);
    await fs.mkdir(dirname(path), { recursive: true });
    let size = 0;
    const limiter = async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > maxBytes) throw new ApiException(413, 'PAYLOAD_TOO_LARGE', `Files may be at most ${maxBytes} bytes`);
        yield chunk;
      }
    };
    try {
      await pipeline(body, limiter, createWriteStream(path));
    } catch (e) {
      await fs.rm(path, { force: true });
      throw e;
    }
    return size;
  }

  async stat(key: string) {
    try {
      return await fs.stat(this.pathFor(key));
    } catch {
      return null;
    }
  }

  read(key: string) {
    return createReadStream(this.pathFor(key));
  }

  async remove(key: string) {
    await fs.rm(this.pathFor(key), { force: true });
  }

  private sign(op: StorageOp, key: string, expires: number, extra: Record<string, string>) {
    const extras = Object.keys(extra).sort().map((k) => `${k}=${extra[k]}`).join('&');
    return createHmac('sha256', this.config.storageSigningSecret).update(`${op}\n${key}\n${expires}\n${extras}`).digest('base64url');
  }

  private pathFor(key: string) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw ApiException.badRequest('INVALID_KEY', 'Invalid storage key');
    return join(this.root, key);
  }
}
