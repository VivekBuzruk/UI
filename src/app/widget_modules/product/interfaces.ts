export interface IProductResponse {
  result: ITeamPipe[];
  lastUpdated: number;
}

export interface IOrderMap {
  orderVal : number;
  stage : string;
}

export interface IStageEntry {
  numberOfChanges : number;
  processedTimestamps : {[key: string]: number}[];
  scmAuthor: string;
  scmAuthorLogin?: string;
  scmBranch?: string;
  scmCommitLog: string;
  scmCommitTimestamp: number;
  scmParentRevisionNumbers?:{[key: number]: string}[];
  scmRevisionNumber: string;
  scmUrl?: string;
  type?: string;
}

export interface ITeamPipe {
  collectorItemId: string;
  orderMap: IOrderMap[];
  prodStage: string;
  stages: {[key: string]: IStageEntry[]}[];
}

export interface IProductTeam {
  collectorItemId: string; // "5fba52761d68914d1c826bec"
  customName: string; // "LocalTeam2"
  dashBoardId: string;  // "5fba52751d68914d1c826beb"
  name: string;         // "Local 2"
}

export interface IProdConfigOptions {
  id : string; // "product0"
  teams: IProductTeam[];
}
export interface IProdWidget {
  componentId : string;  // "5fba538a1d68914d1c826bfa"
  id: string;   // "5fba94721d68914d1c826c65"
  name: string; // "product"
  options: IProdConfigOptions;
}