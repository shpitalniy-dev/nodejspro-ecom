export interface UploadIntentSingleResult {
  fileUuid: string;
  key: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface UploadIntentMultipartResult {
  fileUuid: string;
  key: string;
  uploadId: string;
  partSize: number;
  parts: { partNumber: number; uploadUrl: string }[];
  expiresIn: number;
}

export type UploadIntentResult =
  | UploadIntentSingleResult
  | UploadIntentMultipartResult;

export interface UploadResumeResult {
  fileUuid: string;
  key: string;
  uploadId: string;
  partSize: number;
  parts: { partNumber: number; uploadUrl: string }[];
}

export interface UploadCommitResult {
  fileUuid: string;
  key: string;
  status: 'completed';
  size: number;
}
