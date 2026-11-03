import 'reflect-metadata';

import {
  CreateMultipartUploadCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import type { Env } from '../../../config/env.schema.ts';
import { File as FileEntity } from '../../../entities/file.entity.ts';
import { User as UserEntity } from '../../../entities/user.entity.ts';
import { DataSourceService } from '../../../services/data-source.service.ts';
import { S3ClientService } from '../../../services/storage/s3-client.service.ts';
import { DEMO_BUYER_EMAIL, startDemoApp } from '../../auth/demo/demo.utils.ts';
import { FilesService } from '../files.service.ts';

import { cleanupFiles } from './demo.utils.ts';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// demo:reap — stale-pending cleanup (HW #26 hint, not one of the 3 graded
// demos). Proves reapStalePending() actually reaps what it should and
// nothing else: a plain abandoned intent, an abandoned multipart upload
// (uploadId still open on storage until aborted), and a fresh pending row
// that's nowhere near the age threshold.
async function main(): Promise<void> {
  const app = await startDemoApp();

  const manager = await app.app.get(DataSourceService).getManager();
  const repo = manager.getRepository(FileEntity);
  const buyer = await manager
    .getRepository(UserEntity)
    .findOneByOrFail({ email: DEMO_BUYER_EMAIL });
  const bucket = app.app
    .get(ConfigService<Env, true>)
    .get('STORAGE_BUCKET_UPLOADS', { infer: true });
  const s3 = app.app.get(S3ClientService).client;

  const staleAt = new Date(Date.now() - 2 * ONE_DAY_MS);

  let staleUuid: string | undefined;
  let freshUuid: string | undefined;
  let staleMultipartUuid: string | undefined;

  try {
    const stale = await repo.save(
      repo.create({
        key: `pending/${buyer.uuid}/${randomUUID()}.png`,
        owner: buyer,
        status: 'pending',
        contentType: 'image/png',
        declaredSize: '1',
        createdAt: staleAt,
      }),
    );
    staleUuid = stale.uuid;

    const fresh = await repo.save(
      repo.create({
        key: `pending/${buyer.uuid}/${randomUUID()}.png`,
        owner: buyer,
        status: 'pending',
        contentType: 'image/png',
        declaredSize: '1',
      }),
    );
    freshUuid = fresh.uuid;

    const multipartKey = `uploads/${buyer.uuid}/${randomUUID()}.png`;
    const { UploadId } = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: multipartKey,
        ContentType: 'image/png',
      }),
    );

    if (!UploadId) {
      throw new Error('CreateMultipartUpload returned no UploadId');
    }

    const staleMultipart = await repo.save(
      repo.create({
        key: multipartKey,
        owner: buyer,
        status: 'pending',
        contentType: 'image/png',
        declaredSize: '1',
        uploadId: UploadId,
        partSize: String(5 * 1024 * 1024),
        partCount: 1,
        createdAt: staleAt,
      }),
    );
    staleMultipartUuid = staleMultipart.uuid;

    const reaped = await app.app.get(FilesService).reapStalePending(ONE_DAY_MS);

    const staleGone =
      (await repo.findOne({ where: { uuid: stale.uuid } })) === null;
    const freshSurvived =
      (await repo.findOne({ where: { uuid: fresh.uuid } })) !== null;
    const multipartRowGone =
      (await repo.findOne({ where: { uuid: staleMultipart.uuid } })) === null;
    const { Uploads = [] } = await s3.send(
      new ListMultipartUploadsCommand({ Bucket: bucket }),
    );
    const multipartAborted = !Uploads.some(
      upload => upload.UploadId === UploadId,
    );

    console.log('demo:reap — stale-pending cleanup');
    console.log(`reaped=${reaped}`);
    console.log(`stale-gone=${staleGone ? 1 : 0}`);
    console.log(`fresh-survived=${freshSurvived ? 1 : 0}`);
    console.log(`multipart-row-gone=${multipartRowGone ? 1 : 0}`);
    console.log(`multipart-aborted=${multipartAborted ? 1 : 0}`);

    const invariantOk =
      reaped === 2 &&
      staleGone &&
      freshSurvived &&
      multipartRowGone &&
      multipartAborted;

    if (invariantOk) {
      console.log(
        'invariant check passed — stale pending rows (plain and multipart) are reaped, the open upload is aborted, and the fresh row is untouched',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    // reapStalePending() already removed the two stale rows on success —
    // cleanupFiles() no-ops gracefully on a uuid it can't find, so this
    // only has real work left to do (freshUuid) on the happy path, and
    // covers whatever's left over on a failed run.
    await cleanupFiles(app.app, [staleUuid, freshUuid, staleMultipartUuid]);
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
