export interface UploadIntentResult {
  fileUuid: string;
  key: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface UploadCommitResult {
  fileUuid: string;
  key: string;
  status: 'completed';
  size: number;
}
