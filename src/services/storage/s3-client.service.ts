import { S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.ts';

// One configured S3Client, shared by every HW #26 slice that needs to talk
// to storage (files.service.ts here; multipart and CDN demos reuse it
// rather than each building their own). forcePathStyle is required for
// Garage (and most S3-compatible emulators) — real AWS S3 tolerates it too.
@Injectable()
export class S3ClientService {
  readonly client: S3Client;

  constructor(config: ConfigService<Env, true>) {
    this.client = new S3Client({
      endpoint: config.get('STORAGE_ENDPOINT', { infer: true }),
      region: config.get('STORAGE_REGION', { infer: true }),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('STORAGE_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('STORAGE_SECRET_KEY', { infer: true }),
      },
      // SDK v3 defaults to signing a CRC32 of the request body into
      // presigned URLs, even an empty one at sign time (x-amz-checksum-
      // crc32=AAAAAA==) — fine on Garage, a known source of integrity
      // mismatches on some other S3-compatible stores. WHEN_REQUIRED only
      // attaches a checksum when the caller asks for one.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }
}
