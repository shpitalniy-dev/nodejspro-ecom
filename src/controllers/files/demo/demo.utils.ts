import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import net from 'node:net';

import type { Env } from '../../../config/env.schema.ts';
import { File as FileEntity } from '../../../entities/file.entity.ts';
import { DataSourceService } from '../../../services/data-source.service.ts';
import { S3ClientService } from '../../../services/storage/s3-client.service.ts';

export function isPortOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });

    const finish = (alive: boolean): void => {
      socket.destroy();
      resolve(alive);
    };

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

async function deleteFile(
  app: INestApplication,
  fileUuid: string,
): Promise<void> {
  const manager = await app.get(DataSourceService).getManager();
  const repo = manager.getRepository(FileEntity);
  const row = await repo.findOne({ where: { uuid: fileUuid } });

  if (!row) {
    return;
  }

  const bucket = app
    .get(ConfigService<Env, true>)
    .get('STORAGE_BUCKET_UPLOADS', { infer: true });

  await app
    .get(S3ClientService)
    .client.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.key }));

  await repo.remove(row);
}

export async function cleanupFiles(
  app: INestApplication,
  fileUuids: Array<string | undefined>,
): Promise<void> {
  const results = await Promise.allSettled(
    fileUuids
      .filter((uuid): uuid is string => uuid !== undefined)
      .map(uuid => deleteFile(app, uuid)),
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[demo] file cleanup failed:', result.reason);
    }
  }
}
