import { Controller, Get, HttpCode, Param, Put, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Readable } from 'stream';
import { Public } from '../../common/auth/decorators';
import { ApiException } from '../../common/http/api-exception';
import { StorageService } from './storage.service';

/** Endpoints addressed by signed URLs (the signature is the authorization). */
@ApiExcludeController()
@Public()
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Put(':org/:object')
  @HttpCode(200)
  async upload(@Param('org') org: string, @Param('object') object: string, @Query() q: Record<string, string>, @Req() req: Request) {
    const key = `${org}/${object}`;
    this.storage.verify('put', key, Number(q.exp), q.sig);
    if (await this.storage.stat(key)) throw ApiException.conflict('ALREADY_UPLOADED', 'An object already exists for this URL');
    // express.raw() in main.ts buffers the body for this route.
    const body = Buffer.isBuffer(req.body) ? Readable.from([req.body]) : req;
    const size = await this.storage.write(key, body);
    return { storageKey: key, size };
  }

  @Get(':org/:object')
  async download(@Param('org') org: string, @Param('object') object: string, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    const key = `${org}/${object}`;
    const extra = { name: q.name ?? '', type: q.type ?? '' };
    this.storage.verify('get', key, Number(q.exp), q.sig, extra);
    const stat = await this.storage.stat(key);
    if (!stat) throw ApiException.notFound('object');
    return new StreamableFile(this.storage.read(key), {
      type: extra.type || 'application/octet-stream',
      length: stat.size,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(extra.name || 'download')}`,
    });
  }
}
