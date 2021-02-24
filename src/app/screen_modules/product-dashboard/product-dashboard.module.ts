import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import {ProductModule} from '../../widget_modules/product/product.module';

@NgModule({
  declarations: [],
  imports: [
    SharedModule,
    ProductModule
  ]
})
export class ProductDashboardModule { }
