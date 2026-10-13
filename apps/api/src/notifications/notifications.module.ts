import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.js';

/** One mail queue connection for the whole API. */
@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class NotificationsModule {}
