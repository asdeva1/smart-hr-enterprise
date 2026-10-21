import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [EmployeesModule, ProjectsModule, OperationsModule, AssetsModule, InventoryModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
