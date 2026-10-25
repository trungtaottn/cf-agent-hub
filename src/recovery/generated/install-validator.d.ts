// Generated from the canonical recovery install discriminant.
import type {DeploymentConfig,VerificationBundle} from "../../config/generated/validators.js";
export type OperatorInstallRequest={"operation":"install";"workspace_id":string;"capture_id":null;"expected_authority_epoch":number;"operation_id":string;"reason":string;"payload":{"config":DeploymentConfig;"verification_bundle":VerificationBundle;};};
export declare function validateInstall(input:unknown):input is OperatorInstallRequest;
