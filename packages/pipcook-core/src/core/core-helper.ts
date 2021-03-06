/**
 * @file This file is for helper functions related to Pipcook-core
 */
import * as path from 'path';
import {PipcookRunner} from './core'; 
import {PipcookComponentResult} from '../types/component';
import {ModelDeployType} from '../types/plugins';
import {logCurrentExecution} from '../utils/logger';
import {Observable, from} from 'rxjs';
import {flatMap} from 'rxjs/operators';
import {DATA, MODEL, EVALUATE, DEPLOYMENT, MODELTOSAVE, ORIGINDATA} from '../constants/other';
import {DATAACCESS} from '../constants/plugins';


/**
 * Retreive relative logs required to be stored.
 * @param pipcookRunner : The pipcookRunner object
 */
export function getLog(pipcookRunner: PipcookRunner) {
  return pipcookRunner;
}

  /**
   * According to return type of plugin, we need to update runner.
   * @param updatedType: updated return type of plugin
   * @param result: lasted return data of plugin
   */
  export async function assignLatestResult(updatedType: string, result: any, self: any) {
    switch (updatedType) {
      case DATA:
        self.latestSampleData = result;
        break;
      case MODEL:
        self.latestModel = result;
        break;
      case EVALUATE:
        self.latestEvaluateResult = result;
        break;
      case DEPLOYMENT:
        self.latestDeploymentResult = result;
        break;
      case ORIGINDATA:
        self.latestOriginSampleData = result;
        break;
      case MODELTOSAVE:
        self.latestModel = result;
        if (Array.isArray(result)) {
          result.forEach(async (model) => {
            await model.save(path.join(<string>self.logDir, 'models' ,self.pipelineId + '-' + model.modelName +'-model'));
          })
        } else {
          await result.save(path.join(<string>self.logDir, 'models', self.pipelineId + '-' + result.modelName +'-model'));
        }
        break;
      default:
        throw new Error('Returned Data Type is not recognized');
    }
  }

/**
 * create the pipeline according to the components given. The pipelien serializes all components sepcified
 * @param components: EscherComponent 
 * @param self: the pipeline subject
 */
export function createPipeline(components: PipcookComponentResult[], self: any, logType='normal') {
  const firstComponent = components[0];
  firstComponent.status = 'running';
  logCurrentExecution(firstComponent, logType)
  const insertParams = {
    
  }
  const firstObservable = <Observable<any>>firstComponent.observer(self.latestOriginSampleData, self.latestModel, insertParams);
  self.updatedType = firstComponent.returnType;

  const flatMapArray: any = [];
  self.currentIndex = 0;
  for (let i = 1; i < components.length; i++) {
    // rxjs pipe: serialize all components
    (function execute(component, assignLatestResult, updatedType, self, flatMapArray)  {
      const flatMapObject = flatMap((result) => {
        component.previousComponent.status = 'success';
        self.currentIndex++;
        logCurrentExecution(component, logType);
        return from(assignLatestResult(updatedType, result, self)).pipe(
          flatMap(() => {
            if (component.type === DATAACCESS) {
              return component.observer(self.latestOriginSampleData, self.latestModel, insertParams);
            } else {
              return component.observer(self.latestSampleData, self.latestModel, insertParams);
            }
            
          })
        )  
      });
      flatMapArray.push(flatMapObject);
    })(components[i], assignLatestResult, self.updatedType, self, flatMapArray);
    self.updatedType = components[i].returnType;
  }
  
  return firstObservable.pipe(
    // @ts-ignore
    ...flatMapArray
  );
}

/**
 * After the user specifiy the components used for current pipeline, 
 * we link each component to its previous component
 * @param components : PipcookComponentResult[]
 */
export function linkComponents(components: PipcookComponentResult[]) {
  for (let i = 1; i < components.length; i++) {
    components[i].previousComponent = components[i-1];
  }
}

/**
 * After the pipeline is finished, 
 * those components which are not changed to success status should be failing ones
 * @param components 
 */
export function assignFailures(components: PipcookComponentResult[]) {
  components.forEach((component: PipcookComponentResult) => {
    if (component.status === 'running') {
      component.status = 'failure';
    }
    if (component.mergeComponents) {
      component.mergeComponents.forEach((componentArray: PipcookComponentResult[]) => {
        componentArray.forEach((component: PipcookComponentResult) => {
          if (component.status === 'running') {
            component.status = 'failure';
          }
        })
      })
    }
  })
}

/**
 * this is to start the pipcook prediction service.
 * The function will be called after the pipeline is finished and predictServer parameter is true
 */
export async function runPredict(runner: PipcookRunner, request: any) {
  const {components, latestModel} = runner;
  const {data} = request.body;

  // we need to find out the dataAccess and dataProcess component 
  // since the prediction data needs to be processed by these two steps
  const dataAccess = components.find((e) => e.type === 'dataAccess');
  const dataProcess = components.find((e) => e.type === 'dataProcess');
  const modelDeploy = components.find((e) => e.type === 'modelDeploy');

  const result = await (<ModelDeployType>modelDeploy.plugin)({
    data, dataAccess, model: latestModel, dataProcess
  });

  return {
    status: true,
    result: result
  }
}

