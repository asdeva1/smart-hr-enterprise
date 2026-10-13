import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.js';
import { NotificationService } from './notification.service.js';
import { NotificationsController } from './notifications.controller.js';

/** One mail queue connection for the whole API, plus the in-app notification endpoints. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [MailService, NotificationService],
  exports: [MailService, NotificationService],
})
export class NotificationsModule {}
