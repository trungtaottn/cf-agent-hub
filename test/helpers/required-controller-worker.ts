// Dedicated local test Worker. Not a production export or installation path.
export {RequiredFixtureWorkspace as WorkspaceDO} from '../../workers/native-fixture/required-source-projection';
export {RequiredFixtureController} from '../../workers/native-fixture/required-controller';
export default {fetch(request:Request,env:{CONTROLLER:DurableObjectNamespace}){return env.CONTROLLER.getByName('required-fixture-controller').fetch(request);}};
