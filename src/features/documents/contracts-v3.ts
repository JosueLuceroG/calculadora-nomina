import type {StoredFiscalSnapshotV1} from '../storage/snapshot'
import type {Json} from './evidence-v3'
/** Rendering view only. The accepted wire graph is the frozen closed shape-v3
 * descriptor, not the mutable runtime interfaces used by older renderers. */
export type StoredFiscalSnapshotV3=Readonly<Omit<StoredFiscalSnapshotV1,'schemaVersion'|'fiscalPackage'>&{
 schemaVersion:3;documentKind:'qa-document-fixture'|'execution-record';
 fiscalPackage:Readonly<{id:string;version:string;sha256:string;hashScheme:'legacy-registry-v1';exercise:number;supportedDates:{from:string;through:string};parameterSchemaId:string;containerIdentity:{sha256:string;payloadSha256:string;byteLength:number};verification:{origin:'external-signed';basis:'historical-observation';currentTrust:'not-checked'}}>;
 executionProvenance:Readonly<{schemaVersion:1;producerId:string;reportContractId:string;presentationContractId:string;resolution:{exercise:number;fiscalDate:string;periodicity:string;operation:string;simulationProfileId:string;ruleProfileId:string;contextualPolicyId:string};requestScenario:Json;verificationObservation:{verifiedAt:string;rootVersion:number;trustEpoch:number;publishingKeys:string[];approvalKeys:string[];evidenceScope:string;currentTrust:'not-checked'};authorizationObservation:{kind:'not-issued-qa-fixture'|'native-observation-v1';nativeExecutionId:string|null;installationId:string|null;admissionId:string|null;selectionId:string|null;selectionGeneration:number|null;operation:string;authorizedOperations:string[]};policyVersions:readonly {component:string;version:string}[]}>;
 fiscalEvidence:Readonly<{representation:'jcs-envelope-object-v1';packageEnvelope:any;trustHeadEnvelope:any;trustEnvelopeSha256:string;trustPayloadSha256:string;history:{scope:'referenced-not-replayable';documentHashes:string[];episodeCount:number;archiveLocator:string;manifestSha256:string}}>;
 effectiveContext:Readonly<{registryVersion:string;conventionsId:string;ruleSourcesRef:'fiscalEvidence.packageEnvelope.signed.ruleSources';sets:readonly {role:string;family:string;id:string;version:string}[]}>;
}>
