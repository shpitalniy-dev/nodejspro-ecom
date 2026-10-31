import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import { ALLOWED_UPLOAD_CONTENT_TYPES } from './files.service.ts';

// Defense-in-depth on top of openapi.yaml's own contract, same relationship
// CreateOrderDto has to CreateOrderRequest (see that file's own comment).
export class CreateUploadIntentDto {
  @IsIn(Object.keys(ALLOWED_UPLOAD_CONTENT_TYPES))
  contentType!: string;

  // Mandatory: decides single-PUT vs. multipart (files.service.ts's
  // MULTIPART_THRESHOLD_BYTES) and is checked against the real,
  // storage-reported size at commit() — see declaredSize on the entity.
  @IsInt()
  @Min(1)
  size!: number;

  // Accepted but never used to build the storage key — see
  // files.service.ts's createIntent(). Exists so demo:upload has something
  // malicious to send (`../../etc/passwd`) and prove gets discarded.
  @IsOptional()
  @IsString()
  filename?: string;
}

export class CommitUploadDto {
  @IsUUID()
  fileUuid!: string;
}
