import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Redirect,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guards.ts';
import type { AccessTokenClaims } from '../auth/auth.types.ts';
import { CurrentUser } from '../auth/current-user.decorator.ts';

import { CommitUploadDto, CreateUploadIntentDto } from './files.dto.ts';
import { FilesService } from './files.service.ts';

@Controller('uploads')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // Read path: never hand out a long-lived presigned GET (it can't be
  // revoked — see files.service.ts's getReadUrl()), hand out this
  // endpoint instead and mint a fresh one on every request.
  @Get(':fileUuid')
  @Redirect()
  @UseGuards(AuthGuard)
  async getFile(
    @Param('fileUuid', new ParseUUIDPipe()) fileUuid: string,
    @CurrentUser() claims: AccessTokenClaims,
  ) {
    const url = await this.filesService.getReadUrl(fileUuid, claims.sub);

    return { url, statusCode: 302 };
  }

  @Post('intent')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async intent(
    @Body() body: CreateUploadIntentDto,
    @CurrentUser() claims: AccessTokenClaims,
  ) {
    return this.filesService.createIntent(
      claims.sub,
      body.contentType,
      body.size,
    );
  }

  @Post('resume')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async resume(
    @Body() body: CommitUploadDto,
    @CurrentUser() claims: AccessTokenClaims,
  ) {
    return this.filesService.resumeUpload(body.fileUuid, claims.sub);
  }

  @Post('commit')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async commit(
    @Body() body: CommitUploadDto,
    @CurrentUser() claims: AccessTokenClaims,
  ) {
    return this.filesService.commit(body.fileUuid, claims.sub);
  }
}
