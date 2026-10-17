import { Module, type OnModuleInit } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { uploadsModule } from '../documents/uploads.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { HiringService } from './hiring.service.js';
import { OnboardingService } from './onboarding.service.js';
import { OnboardingController, RecruitmentController } from './recruitment.controller.js';
import { RecruitmentService } from './recruitment.service.js';

@Module({
  imports: [uploadsModule(), DocumentsModule, EmployeesModule],
  controllers: [RecruitmentController, OnboardingController],
  providers: [RecruitmentService, HiringService, OnboardingService],
})
export class RecruitmentModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** Recruitment and onboarding records are part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('jobOpenings', (tx) => tx.jobOpening.findMany({ orderBy: { code: 'asc' } }));
    this.exporter.register('candidates', (tx) => tx.candidate.findMany({ orderBy: { createdAt: 'asc' } }));
    this.exporter.register('jobApplications', (tx) =>
      tx.jobApplication.findMany({ orderBy: { createdAt: 'asc' }, include: { events: true } }),
    );
    this.exporter.register('interviews', (tx) =>
      tx.interview.findMany({ orderBy: { scheduledAt: 'asc' }, include: { feedback: true } }),
    );
    this.exporter.register('jobOffers', (tx) => tx.jobOffer.findMany({ orderBy: { createdAt: 'asc' } }));
    this.exporter.register('onboardingTemplates', (tx) =>
      tx.onboardingTemplate.findMany({ orderBy: { name: 'asc' }, include: { tasks: true } }),
    );
    this.exporter.register('onboardingPlans', (tx) =>
      tx.onboardingPlan.findMany({ orderBy: { createdAt: 'asc' }, include: { tasks: true } }),
    );
  }
}
