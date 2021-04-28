import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ComponentFactoryResolver,
  OnDestroy,
  OnInit,
  ViewChild,
} from "@angular/core";
import { of, from, Subscription, Observable } from "rxjs";
import { distinctUntilChanged, startWith, switchMap } from "rxjs/operators";
import { filter, map, tap } from "rxjs/operators";
import { linear, DataPoint, Result } from "regression"; // Shift to https://www.npmjs.com/package/simple-statistics
import {
  IClickListData,
  IClickListItem,
} from "src/app/shared/charts/click-list/click-list-interfaces";
import { DashStatus } from "src/app/shared/dash-status/DashStatus";
import { DashboardService } from "src/app/shared/dashboard.service";
import { LayoutDirective } from "src/app/shared/layouts/layout.directive";
import { OneChartLayoutComponent } from "src/app/shared/layouts/one-chart-layout/one-chart-layout.component";
import { WidgetComponent } from "src/app/shared/widget/widget.component";
import { ProductDetailComponent } from "../product-detail/product-detail.component";
import { ProductService } from "../product.service";
import {
  ProductPipelineService,
  IProdCommitData,
  ILastRequest,
} from "../product-pipeline.service";
import {
  ITeamPipe,
  IProductTeam,
  IStageEntry,
  IOrderMap,
  IProdWidget,
  IProdConfigOptions,
} from "../interfaces";
import {
  StageEachCommit,
  StageCommit,
  ProdCommitTime,
  TeamProdData,
  ViewData,
} from "../interfaces";
import { PRODUCT_CHARTS } from "./product-charts";
// @ts-ignore
import moment from "moment";
import { groupBy } from "lodash";

import { WidgetState } from "../../../shared/widget-header/widget-state";
import { DEFAULT_BREAKPOINTS } from "@angular/flex-layout";

@Component({
  selector: "app-product-widget",
  templateUrl: "./product-widget.component.html",
  styleUrls: ["./product-widget.component.scss"],
})
export class ProductWidgetComponent
  extends WidgetComponent
  implements OnInit, AfterViewInit, OnDestroy {
  private readonly BUILDS_PER_DAY_TIME_RANGE = 14;
  private readonly TOTAL_BUILD_COUNTS_TIME_RANGES = [7, 14];

  private buildTimeThreshold: number;
  private readonly useOldTotalBuildCharts = false;

  // Default build time threshold
  private readonly BUILD_TIME_THRESHOLD = 900000;

  // Reference to the subscription used to refresh the widget
  private intervalRefreshSubscription: Subscription;

  private teamCtrlStages: ITeamPipe;

  @ViewChild(LayoutDirective, { static: false })
  childLayoutTag: LayoutDirective;

  constructor(
    componentFactoryResolver: ComponentFactoryResolver,
    cdr: ChangeDetectorRef,
    dashboardService: DashboardService,
    private productService: ProductService,
    private productPipelineService: ProductPipelineService
  ) {
    super(componentFactoryResolver, cdr, dashboardService);
  }

  // Initialize the widget and set layout and charts.
  ngOnInit() {
    this.widgetId = "product0";
    this.layout = OneChartLayoutComponent;

    this.charts = PRODUCT_CHARTS;

    this.auditType = "";
    this.init();
    console.log(
      "*** product-widget ngOnInit, productPipelineService = ",
      this.productPipelineService
    );
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
      ninetyDaysAgo = now.add(-90, "days").valueOf(),
      dateBegins = ninetyDaysAgo.toString();
    var nowTimestamp = moment().valueOf();
    var productTeams: IProductTeam[];
    var teamDashboardDetails: any = {};

    this.intervalRefreshSubscription = this.dashboardService.dashboardRefresh$
      .pipe(
        startWith(-1), // Refresh this widget separate from dashboard (ex. config is updated)
        distinctUntilChanged(), // If dashboard is loaded the first time, ignore widget double refresh
        switchMap((_) => this.getCurrentWidgetConfig()),
        switchMap((widgetConfig: IProdWidget) => {
          if (!widgetConfig) {
            return from([]);
          }
          this.widgetConfigExists = true;
          this.state = WidgetState.READY;
          productTeams = widgetConfig.options.teams;
          return from(productTeams);
        }),
        switchMap((productTeam: IProductTeam) => {
          return this.processTeam(
            productTeam,
            nowTimestamp,
            dateBegins,
            dateEnds
          );
        })
      )
      .subscribe((result: ITeamPipe[]) => {
        this.hasData = result && result.length > 0;
        console.log(
          "*** Vivek: Product-widget, startRefreshInterval, received result is - ",
          result
        );
        // put all results in the database
        result.forEach((teamResponse: ITeamPipe) =>
          this.processLoad(
            teamResponse,
            nowTimestamp,
            dateBegins,
            dateEnds,
            ninetyDaysAgo
          )
        );
      });
  }

  processTeam(
    productTeam: IProductTeam,
    nowTimestamp: any,
    dateBegins: any,
    dateEnds: any
  ): Observable<ITeamPipe[]> {
    this.productPipelineService.addLastRequest({
      id: productTeam.collectorItemId,
      type: "pipeline-commit",
      timestamp: nowTimestamp,
    });
    return this.productService.commits(
      dateBegins,
      nowTimestamp.toString(),
      productTeam.collectorItemId
    ); // return null;
  }

  processLoad(
    teamResponse: ITeamPipe,
    nowTimestamp: any,
    dateBegins: any,
    dateEnds: any,
    ninetyDaysAgo: any
  ) {
    var teamStages = Object.keys(teamResponse.stages) as Array<string>;
    console.log(
      "*** Vivek: Product-widget, startRefreshInterval, Stages - ",
      teamStages
    );

    teamResponse.stages[teamResponse.prodStage].forEach(
      (commit: IStageEntry) => {
        // extend the commit object with fields we need
        // to search the db
        console.log(
          "**Vivek** product commit-data processPipelineCommitResponse, commit = ",
          commit
        );
        console.log(
          "**Vivek** product commit-data processPipelineCommitResponse, this = ",
          this
        );
        this.productPipelineService.addProdCommitData({
          collectorItemId: teamResponse.collectorItemId,
          numberOfChanges: commit.numberOfChanges,
          processedTimestamps: commit.processedTimestamps,
          scmAuthor: commit.scmAuthor,
          scmCommitTimeStamp: commit.scmCommitTimestamp,
          scmRevisionNumber: commit.scmRevisionNumber,
          timestamp: commit.processedTimestamps[teamResponse.prodStage],
        });
        console.log(
          "**Vivek** product commit-data processPipelineCommitResponse, commit Done "
        );
        this.productPipelineService.deleteCommitData(
          this.productPipelineService.prodCommit,
          ninetyDaysAgo
        );
      }
    );
    // this.dashboardService.getDashboard(productTeams[0].dashBoardId).subscribe(response => {
    //   console.log("*** Vivek: Team Dashboard = ", response);
    //   teamDashboardDetails[teamResponse.collectorItemId] = response;
    // });

    console.log(
      "**Vivek** product commit-data processPipelineCommitResponse, call getProdCommitData "
    );
    this.productPipelineService
      .getProdCommitData(teamResponse.collectorItemId, ninetyDaysAgo, dateEnds)
      .toArray((rows: IProdCommitData[]) => {
        var uniqueRows = [
          ...new Map(
            rows.map((item) => [item["scmRevisionNumber"], item])
          ).values(),
        ];
        var teamCommitData: IProdCommitData[] = new Array();
        teamCommitData[teamResponse.prodStage] = uniqueRows.sort(
          (a, b) => b.timestamp - a.timestamp
        );
        console.log("Rows ", rows);
        console.log("Unique Rows ", uniqueRows);
        console.log(
          "Prod Stage Commits ",
          teamCommitData[teamResponse.prodStage]
        ); // result[0].stages
        console.log(
          "Prod Stage Orig. Data ",
          teamResponse.stages[teamResponse.prodStage]
        );

        var stageNames = [].concat(
          Object.keys(teamResponse.stages) as Array<string>
        ); // ['key1', 'key2']
        stageNames.forEach((key: string) => {
          var value = teamResponse.stages[key];
          console.log("Key " + key + " and StageEntry = ", value);
        });
        // let stages : IStageEntry[] = [].concat(teamResponse.stages);
        var stageDurations: any = {};
        var teamStageData: StageCommit[] = new Array();
        let nextStageName = "";
        stageNames.reverse().forEach((currentStage: string) => {
          var commits = []; // store our new commit object
          var localStages = [].concat(
            Object.keys(teamResponse.stages) as Array<string>
          );
          var previousStages = localStages
            .splice(0, localStages.indexOf(currentStage))
            .reverse(); //.values(); // only look for stages before this one

          console.log("**Vivek** CurrentStage = " + currentStage);
          commits = this.commitsForStage(
            teamResponse,
            currentStage,
            nextStageName,
            stageDurations,
            previousStages,
            nowTimestamp
          );
          // make sure commits are always set
          teamStageData[currentStage] = {
            commits: commits,
          };
          nextStageName = currentStage;
        });

        // now that we've added all the duration data for all commits in each stage
        // we can calculate the averages and std deviation and put the data on the stage
        for (const currentStageName in stageDurations) {
          // stageDurations.forEach(function (durationArray, currentStageName) {
          if (!teamStageData[currentStageName]) {
            teamStageData[currentStageName] = {};
          }

          let stats = this.getStageDurationStats(
            stageDurations[currentStageName]
          ); // durationArray
          teamStageData[currentStageName].stageAverageTime = stats.mean;
          teamStageData[currentStageName].stageStdDeviation = stats.deviation;
        }
        // now that we have average and std deviation we can determine if a commit
        // has been in the environment for longer than 2 std deviations in which case
        // it should be marked as a failure
        for (const stage in teamStageData) {
          if (
            !teamStageData[stage].stageStdDeviation ||
            !teamStageData[stage].commits
          ) {
            return;
          }

          teamStageData[stage].commits.forEach(function (commit) {
            // use the time it's been in the existing environment to compare
            var timeInStage = commit.in[stage];

            commit.errorState =
              timeInStage > 2 * teamStageData[stage].stageStdDeviation;
          });
        }
        this.createSummaryData(teamStageData);
        // handle the api telling us which stages need configuration

        let teamProdData: TeamProdData = this.getTeamProdData(
          teamResponse,
          teamResponse.prodStage
        );
        if (teamResponse.unmappedStages) {
          for (var stageName in teamStageData) {
            teamStageData[stageName].needsConfiguration =
              teamResponse.unmappedStages.indexOf(stageName) != -1;
          }
        }

        setTimeout(function () {
          this.setTeamData(teamResponse.collectorItemId, {
            stages: teamStageData,
            prod: teamProdData,
            prodStage: teamResponse.prodStage,
          });
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
  }

  commitsForStage(
    teamResponse,
    currentStage,
    nextStageName,
    stageDurations,
    previousStages,
    nowTimestamp
  ) {
    let commits = [];
    teamResponse.stages[currentStage].forEach((commitObj: IStageEntry) => {
      console.log(
        "**Vivek** CommitObj, scmRevisionNumber = " +
          commitObj.scmRevisionNumber
      );
      let commit: StageEachCommit = {
        author: commitObj.scmAuthor || "NA",
        message: commitObj.scmCommitLog || "No message",
        id: commitObj.scmRevisionNumber,
        timestamp: commitObj.scmCommitTimestamp,
        in: {}, //placeholder for stage duration data per commit
      };
      //$log.debug("**DIW-D** product commit-data, processPipelineCommitData commitObj = ", commitObj);
      // make sure this stage exists to track durations
      if (stageDurations[currentStage] === undefined) {
        stageDurations[currentStage] = [];
      }

      // use this commit to calculate time in the current stage
      let currentStageTimestampCompare = commit.timestamp;
      if (commitObj.processedTimestamps[currentStage]) {
        currentStageTimestampCompare =
          commitObj.processedTimestamps[currentStage];
      }

      // use this time in our metric calculations
      let timeInCurrentStage = nowTimestamp - currentStageTimestampCompare;
      if (
        nextStageName != "" &&
        teamResponse.stages[nextStageName].length == 0
      ) {
        stageDurations[currentStage].push(timeInCurrentStage);
      }

      // make sure current stage is set
      commit.in[currentStage] = timeInCurrentStage;

      // on each commit, set data for how long it was in each stage by looping
      // through any previous stage and subtracting its timestamp from the next stage
      let currentStageTimestamp = commitObj.processedTimestamps[currentStage];

      previousStages.forEach((previousStage: string) => {
        console.log("**Vivek** CommitObj TimeStamp with " + previousStage);
        if (
          !commitObj.processedTimestamps[previousStage] ||
          isNaN(currentStageTimestamp)
        ) {
          return;
        }

        let previousStageTimestamp =
            commitObj.processedTimestamps[previousStage],
          timeInPreviousStage = currentStageTimestamp - previousStageTimestamp;

        // it is possible that a hot-fix or some other change was made which caused
        // the commit to skip an earlier environment. In this case just set that
        // time to 0 so it's considered in the calculation, but does not negatively
        // take away from the average
        timeInPreviousStage = Math.max(timeInPreviousStage, 0);

        // add how long it was in the previous stage
        commit.in[previousStage] = timeInPreviousStage;

        // add this number to the stage duration array so it can be used
        // to calculate each stages average duration individually
        if (!stageDurations[previousStage]) {
          stageDurations[previousStage] = [];
        }

        // add this time to our duration list
        stageDurations[previousStage].push(timeInPreviousStage);

        // now use this as our new current timestamp
        currentStageTimestamp = previousStageTimestamp;
      });
      // add our commit object back
      commits.push(commit);
    });
    return commits;
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
      this.charts[0].data.dataPoints[0].series = [
        { name: new Date(), value: 0, data: "All Builds" },
      ];
      this.charts[0].data.dataPoints[1].series = [
        { name: new Date(), value: 0, data: "Failed Builds" },
      ];
      this.charts[1].data = { items: [{ title: "No Data Found" }] };
      this.charts[2].data[0] = [{ name: new Date(), value: 0 }];
      this.charts[2].colorScheme.domain = ["red"];
      this.charts[2].data[1][0].series = [{ name: "No Data Found", value: 0 }];
      this.charts[3].data[0].value = 0;
      this.charts[3].data[1].value = 0;
      this.charts[3].data[2].value = 0;
    }
    super.loadComponent(this.childLayoutTag);
  }

  getStageDurationStats(a): any {
    var r = { mean: 0, variance: 0, deviation: 0 },
      t = a.length;
    for (var m, s = 0, l = t; l--; s += a[l]);
    for (m = r.mean = s / t, l = t, s = 0; l--; s += Math.pow(a[l] - m, 2));
    return (r.deviation = Math.sqrt((r.variance = s / t))), r;
  }

  createSummaryData(teamStageData: StageCommit[]) {
    for (const stageName in teamStageData) {
      // helper for determining whether this stage has current commits
      teamStageData[stageName].summary.hasCommits =
        teamStageData[stageName].commits &&
        teamStageData[stageName].commits.length
          ? true
          : false;
      // green block count
      teamStageData[stageName].summary.commitsInsideTimeFrame = teamStageData[
        stageName
      ].commits.filter((commit: StageEachCommit) => !commit.errorState).length;

      // red block count
      teamStageData[stageName].summary.commitsOutsideTimeframe = teamStageData[
        stageName
      ].commits.filter((commit: StageEachCommit) => commit.errorState).length;

      // stage last updated text
      if (
        !teamStageData[stageName].commits ||
        !teamStageData[stageName].commits.length
      ) {
        teamStageData[stageName].summary.lastUpdated = null;
      } else {
        // try to get the last commit to enter this stage by evaluating the duration
        // for this current stage, otherwise use the commit timestamp
        let lastUpdatedDuration = Math.min(
          ...teamStageData[stageName].commits.map(function (commit) {
            return (
              commit.in[stageName] || moment().valueOf() - commit.timestamp
            );
          })
        );
        let lastUpdated = moment().add(
          -1 * lastUpdatedDuration,
          "milliseconds"
        );

        teamStageData[
          stageName
        ].summary.lastUpdated.longDisplay = lastUpdated.format(
          "MMMM Do YYYY, h:mm:ss a"
        );
        teamStageData[
          stageName
        ].summary.lastUpdated.shortDisplay = lastUpdated.dash("ago");
      }
      // stage deviation
      if (teamStageData[stageName].stageStdDeviation == undefined) {
        teamStageData[stageName].summary.deviation = null;
      } else {
        // determine how to display the standard deviation
        let count = moment
          .duration(2 * teamStageData[stageName].stageStdDeviation)
          .minutes();
        let desc = "min";

        if (count > 60 * 24) {
          desc = "day";
          count = Math.round(count / 24 / 60);
        } else if (count > 60) {
          desc = "hour";
          count = Math.round(count / 60);
        }
        teamStageData[stageName].summary.deviation.count = count;
        teamStageData[stageName].summary.deviation.descriptor = desc;
      }

      if (teamStageData[stageName].stageAverageTime == undefined) {
        teamStageData[stageName].summary.average = null;
      } else {
        let average = moment.duration(
          teamStageData[stageName].stageAverageTime
        );
        teamStageData[stageName].summary.average.days = Math.floor(
          average.asDays()
        );
        teamStageData[stageName].summary.average.hours = Math.floor(
          average.hours()
        );
        teamStageData[stageName].summary.average.minutes = Math.floor(
          average.minutes()
        );
      }
    }
  }

  // calculate info used in prod cell
  getProdCellData(
    teamResponse: ITeamPipe,
    prodStage: string
  ): ProdCommitTime[] {
    let commitTimeToProd: ProdCommitTime[];

    commitTimeToProd = teamResponse.stages[prodStage].map(
      (commit: IStageEntry) => {
        let myProdCommit: ProdCommitTime = {
          duration:
            commit.processedTimestamps[prodStage] - commit.scmCommitTimestamp,
          commitTimestamp: commit.scmCommitTimestamp,
        };
        return myProdCommit;
      }
    );
    return commitTimeToProd;
  }

  getTeamProdData(teamResponse: ITeamPipe, prodStage: string): TeamProdData {
    let teamProdData: TeamProdData = {
      averageDays: "--",
      totalCommits: 0,
      trendUp: false,
    };
    let commitTimeToProd: ProdCommitTime[] = this.getProdCellData(
      teamResponse,
      prodStage
    );
    teamProdData.totalCommits =
      commitTimeToProd != undefined ? commitTimeToProd.length : 0;
    if (teamProdData.totalCommits > 1) {
      let averageDuration: number;

      averageDuration =
        commitTimeToProd.reduce(
          (accumulator, value) => accumulator + value.duration,
          0
        ) / commitTimeToProd.length;
      teamProdData.averageDays = Math.floor(
        moment.duration(averageDuration).asDays()
      );

      let plotData: DataPoint[] = commitTimeToProd.map(function (
        ttp
      ): DataPoint {
        let daysAgo =
          -1 * moment.duration(moment().diff(ttp.commitTimestamp)).asDays();
        let plotPoint: DataPoint = [daysAgo, ttp.duration];
        return plotPoint;
      });
      // let ssPlotData : Array<Array<number>> = new Array();
      // ssPlotData = plotData
      //                 .map ((myDataPoint : DataPoint) =>[myDataPoint[0], myDataPoint[1]]);
      let averageToProdResult: Result = linear(plotData);
      teamProdData.trendUp = averageToProdResult.equation[0] > 0; // gradient
    }
    return teamProdData;
  }

  setTeamData(collectorItemId: string, viewData: ViewData) {}
}
