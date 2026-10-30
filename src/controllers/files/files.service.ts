import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import type { Env } from '../../config/env.schema.ts';
import { File as FileEntity } from '../../entities/file.entity.ts';
import { User as UserEntity } from '../../entities/user.entity.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import { S3ClientService } from '../../services/storage/s3-client.service.ts';

import type { UploadCommitResult, UploadIntentResult } from './files.types.ts';
import { MAGIC_BYTES_CHECK_LENGTH, matchesMagicBytes } from './files.utils.ts';

// The object key's extension comes from here, never from the client's own
// filename — see createIntent()'s own comment on why that matters.
export const ALLOWED_UPLOAD_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Deliberate, scenario-sized TTL — a form upload (avatar, product photo) is
// a minutes-long window, not "7 days because the signing scheme allows it".
// See README's ## Files (HW #26, once that section lands) for the fuller
// rationale.
export const UPLOAD_PRESIGN_TTL_SECONDS = 300;

const UPLOADS_PREFIX = 'uploads';
// Presigned PUTs land here, never directly under UPLOADS_PREFIX — commit()
// moves (CopyObject + DeleteObject) an object out of this prefix into its
// real uploads/ home. Anything left here was PUT but never committed
// (the client abandoned the flow), and garage-init's lifecycle rule
// expires this whole prefix after a day — a storage-level safety net
// that doesn't depend on any app code running to clean it up.
const PENDING_PREFIX = 'pending';

@Injectable()
export class FilesService {
  private readonly bucket: string;

  constructor(
    private readonly dataSourceService: DataSourceService,
    private readonly s3: S3ClientService,
    config: ConfigService<Env, true>,
  ) {
    this.bucket = config.get('STORAGE_BUCKET_UPLOADS', { infer: true });
  }

  async createIntent(
    ownerUuid: string,
    contentType: string,
  ): Promise<UploadIntentResult> {
    const ext = ALLOWED_UPLOAD_CONTENT_TYPES[contentType];

    if (!ext) {
      throw new ConflictException({
        title: 'Unsupported content type',
        detail: `"${contentType}" is not an allowed upload content type.`,
      });
    }

    const manager = await this.dataSourceService.getManager();
    const owner = await manager
      .getRepository(UserEntity)
      .findOne({ where: { uuid: ownerUuid } });

    if (!owner) {
      throw new NotFoundException({
        title: 'User not found',
        detail: `User "${ownerUuid}" not found.`,
      });
    }

    // Server-generated end to end. The client's `filename` (DTO-level
    // only) never reaches here — using the owner's uuid rather than their
    // internal id keeps the path consistent with every other
    // externally-visible identifier in this codebase, and a random uuid
    // for the object itself rules out path collisions and guessable keys.
    // Presigned PUT targets the PENDING_PREFIX staging key, not its final
    // uploads/ home — see that constant's own comment for why.
    const key = `${PENDING_PREFIX}/${ownerUuid}/${randomUUID()}.${ext}`;

    const repo = manager.getRepository(FileEntity);
    const row = await repo.save(
      repo.create({ key, owner, status: 'pending', contentType }),
    );

    const uploadUrl = await getSignedUrl(
      this.s3.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: UPLOAD_PRESIGN_TTL_SECONDS },
    );

    return {
      fileUuid: row.uuid,
      key,
      uploadUrl,
      expiresIn: UPLOAD_PRESIGN_TTL_SECONDS,
    };
  }

  async commit(
    fileUuid: string,
    ownerUuid: string,
  ): Promise<UploadCommitResult> {
    const manager = await this.dataSourceService.getManager();
    const repo = manager.getRepository(FileEntity);
    const row = await repo.findOne({
      where: { uuid: fileUuid },
      relations: { owner: true },
    });

    if (!row) {
      throw new NotFoundException({
        title: 'Upload not found',
        detail: `Upload "${fileUuid}" not found.`,
      });
    }

    if (row.owner.uuid !== ownerUuid) {
      throw new ForbiddenException({
        title: 'Forbidden',
        detail: `Upload "${fileUuid}" belongs to another user.`,
      });
    }

    let head;

    try {
      head = await this.s3.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: row.key }),
      );
    } catch {
      // Nothing was ever PUT to this key — commit() can't complete an
      // upload that never happened. Any 4xx satisfies the homework's own
      // contract here; 409 ("this resource isn't in a state this action
      // can act on") fits better than 404, since the file row itself does
      // exist.
      throw new ConflictException({
        title: 'Upload not found in storage',
        detail: `No object was ever uploaded for "${row.key}".`,
      });
    }

    const { Body } = await this.s3.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: row.key,
        Range: `bytes=0-${MAGIC_BYTES_CHECK_LENGTH - 1}`,
      }),
    );

    const firstBytes = Body ? await Body.transformToByteArray() : null;

    if (!firstBytes || !matchesMagicBytes(firstBytes, row.contentType)) {
      // Left as-is, no new cleanup path needed for this:
      // the lifecycle rule already expires anything there
      // after a day, same as any other abandoned pending upload.
      throw new UnprocessableEntityException({
        title: 'Content does not match declared contentType',
        detail: `The uploaded bytes for "${row.key}" don't match "${row.contentType}"'s file signature.`,
      });
    }

    // Move out of the PENDING_PREFIX staging key into its real uploads/
    // home — CopyObject is a server-side copy (no bytes re-uploaded
    // through us). DB updates to `completed`/the final key BEFORE the
    // staging copy is deleted, not after: if this process died right
    // here, the staging copy is still under PENDING_PREFIX and the
    // lifecycle rule cleans it up anyway, but the final copy would be a
    // permanently untracked orphan (no expiring prefix covers it) if the
    // DB update hadn't already landed.
    const finalKey = `${UPLOADS_PREFIX}${row.key.slice(PENDING_PREFIX.length)}`;

    // Not a tag, because garage doesn't support tagging.
    // More details inside **Copy, not a tag** readme section.
    await this.s3.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${encodeURIComponent(row.key)}`,
        Key: finalKey,
      }),
    );

    const stagingKey = row.key;

    row.status = 'completed';
    row.key = finalKey;
    row.size = String(head.ContentLength ?? 0);
    await repo.save(row);

    // Best-effort — a failure here just means the staging copy outlives
    // the final one until the lifecycle rule expires it on its own.
    await this.s3.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: stagingKey }))
      .catch(() => undefined);

    return {
      fileUuid: row.uuid,
      key: row.key,
      status: 'completed',
      size: Number(row.size),
    };
  }
}
