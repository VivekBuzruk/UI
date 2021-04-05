import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ComponentFactoryResolver,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import {of, Subscription} from 'rxjs';
import {distinctUntilChanged, startWith, switchMap} from 'rxjs/operators';
import {IClickListData, IClickListItem} from 'src/app/shared/charts/click-list/click-list-interfaces';
import {DashStatus} from 'src/app/shared/dash-status/DashStatus';
import {DashboardService} from 'src/app/shared/dashboard.service';
import {LayoutDirective} from 'src/app/shared/layouts/layout.directive';
import {TwoByTwoLayoutComponent} from 'src/app/shared/layouts/two-by-two-layout/two-by-two-layout.component';
import {WidgetComponent} from 'src/app/shared/widget/widget.component';
import {ProductDetailComponent} from '../product-detail/product-detail.component';
import {ProductService} from '../product.service';
import {ProductPipelineService, IProdCommitData, ILastRequest} from '../product-pipeline.service';
import {ITeamPipe, IProductTeam, IStageEntry, IOrderMap, IProdWidget, IProdConfigOptions} from '../interfaces';
import {PRODUCT_CHARTS} from './product-charts';
// @ts-ignore
import moment from 'moment';
import { groupBy } from 'lodash';

import {WidgetState} from '../../../shared/widget-header/widget-state';

@Component({
  selector: 'app-product-widget',
  templateUrl: './product-widget.component.html',
  styleUrls: ['./product-widget.component.scss']
})
export class ProductWidgetComponent extends WidgetComponent implements OnInit, AfterViewInit, OnDestroy {

  private readonly BUILDS_PER_DAY_TIME_RANGE = 14;
  private readonly TOTAL_BUILD_COUNTS_TIME_RANGES = [7, 14];

  private buildTimeThreshold: number;
  private readonly useOldTotalBuildCharts = false;

  // Default build time threshold
  private readonly BUILD_TIME_THRESHOLD = 900000;

  // Reference to the subscription used to refresh the widget
  private intervalRefreshSubscription: Subscription;

  @ViewChild(LayoutDirective, {static: false}) childLayoutTag: LayoutDirective;

  constructor(componentFactoryResolver: ComponentFactoryResolver,
              cdr: ChangeDetectorRef,
              dashboardService: DashboardService,
              private productService: ProductService,
              private productPipelineService : ProductPipelineService) {
    super(componentFactoryResolver, cdr, dashboardService);
  }

  // Initialize the widget and set layout and charts.
  ngOnInit() {
    this.widgetId = 'product0';
    this.layout = TwoByTwoLayoutComponent;
    // Chart configuration moved to external file
    this.charts = PRODUCT_CHARTS;
    
    this.auditType = '';
    this.init();
    console.log("*** product-widget ngOnInit, productPipelineService = ", this.productPipelineService);
  }

  // After the view is ready start the refresh interval.
  ngAfterViewInit() {
    console.log("*** product-widget ngAfterViewInit");
    this.startRefreshInterval();
  }

  ngOnDestroy() {
    console.log("*** product-widget ngOnDestroy");
    this.stopRefreshInterval();
  }

  // Start a subscription to the widget configuration for this widget and refresh the graphs each
  // cycle.
  startRefreshInterval() {
    console.log("*** product-widget startRefreshInterval");
    var now = moment(),
    dateEnds = now.valueOf(),
    ninetyDaysAgo = now.add(-90, 'days').valueOf(),
    dateBegins = ninetyDaysAgo.toString();
    var nowTimestamp = moment().valueOf();
    var productTeams : IProductTeam[];
    var teamDashboardDetails : any = {}; 

    this.intervalRefreshSubscription = this.dashboardService.dashboardRefresh$.pipe(
      startWith(-1), // Refresh this widget separate from dashboard (ex. config is updated)
      distinctUntilChanged(), // If dashboard is loaded the first time, ignore widget double refresh
      switchMap(_ => this.getCurrentWidgetConfig()),
      switchMap((widgetConfig : IProdWidget) => {
        if (!widgetConfig) {
          return of([]);
        }
        this.widgetConfigExists = true;
        this.state = WidgetState.READY;
        console.log("*** Vivek: WidgetConfig is - ", widgetConfig);
        productTeams = widgetConfig.options.teams;
        this.productPipelineService.addLastRequest({
          id: productTeams[0].collectorItemId,
          type: 'pipeline-commit',
          timestamp: nowTimestamp
        });
        return this.productService.commits(dateBegins, nowTimestamp.toString(), widgetConfig.options.teams[0].collectorItemId); // return null; 
      })).subscribe((result : ITeamPipe[]) => {
        this.hasData = (result && result.length > 0);
        console.log("*** Vivek: received result is - ", result);
        // put all results in the database
        result[0].stages[result[0].prodStage].forEach((commit:IStageEntry) => {
                      // extend the commit object with fields we need
                      // to search the db
              console.log("**Vivek** product commit-data processPipelineCommitResponse, commit = ", commit);
              console.log("**Vivek** product commit-data processPipelineCommitResponse, this = ", this);
              this.productPipelineService.addProdCommitData({
                 collectorItemId : productTeams[0].collectorItemId,
                 numberOfChanges : commit.numberOfChanges,
                 processedTimestamps : commit.processedTimestamps,
                 scmAuthor : commit.scmAuthor,
                 scmCommitTimeStamp: commit.scmCommitTimestamp,
                 scmRevisionNumber: commit.scmRevisionNumber,
                 timestamp: commit.processedTimestamps[result[0].prodStage]
              });
              console.log("**Vivek** product commit-data processPipelineCommitResponse, commit Done ");
        });
        // this.dashboardService.getDashboard(productTeams[0].dashBoardId).subscribe(response => {
        //   console.log("*** Vivek: Team Dashboard = ", response);
        //   teamDashboardDetails[productTeams[0].collectorItemId] = response;
        // });

        console.log("**Vivek** product commit-data processPipelineCommitResponse, call getProdCommitData ");
        this.productPipelineService.getProdCommitData(productTeams[0].collectorItemId,
                                                       ninetyDaysAgo, dateEnds)
                                    .toArray((rows : IProdCommitData[]) => {
              var uniqueRows =  [...new Map(rows.map(item =>
                [item['scmRevisionNumber'], item])).values()];
              result[0].stages[result[0].prodStage] = uniqueRows.sort((a, b) => b.timestamp - a.timestamp);
              console.log("Rows " , rows);
              console.log("Unique Rows " , uniqueRows);
              console.log("Prod Stage Commits ", result[0].stages[result[0].prodStage] );

              var stageNames = Object.keys(result[0].stages); // ['key1', 'key2']
              stageNames.forEach( (key : string) => {
                var value = result[0].stages[key];
                console.log("Key " + key + " and StageEntry = ", value);
              });
              // result[0].stages.forEach((stage : {[key: string]: IStageEntry[]}) => {
              //     console.log("Key " + stage.key + " and StageEntry = ");
              // });
        // if (this.hasData) {
        //   this.loadCharts(result);
        // } else {
        //   this.setDefaultIfNoData();
        // }
      });
    });
  }

  // Unsubscribe from the widget refresh observable, which stops widget updating.
  stopRefreshInterval() {
    console.log("*** product-widget stopRefreshInterval");
    if (this.intervalRefreshSubscription) {
      this.intervalRefreshSubscription.unsubscribe();
    }
  }

  loadCharts(result: ITeamPipe[]) {
    console.log("*** product-widget loadCharts");
  }
  setDefaultIfNoData() {
    if (!this.hasData) {
      this.charts[0].data.dataPoints[0].series = [{name: new Date(), value: 0, data: 'All Builds'}];
      this.charts[0].data.dataPoints[1].series = [{name: new Date(), value: 0, data: 'Failed Builds'}];
      this.charts[1].data = { items: [{ title: 'No Data Found' }]};
      this.charts[2].data[0] = [{name: new Date(), value: 0}];
      this.charts[2].colorScheme.domain = ['red'];
      this.charts[2].data[1][0].series = [{name: 'No Data Found', value: 0}];
      this.charts[3].data[0].value = 0;
      this.charts[3].data[1].value = 0;
      this.charts[3].data[2].value = 0;
    }
    super.loadComponent(this.childLayoutTag);
  }
}
