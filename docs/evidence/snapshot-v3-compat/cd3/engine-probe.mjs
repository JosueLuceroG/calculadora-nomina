// Test-only process bridge: consumes a NEW native acquisition produced by the
// running Rust test. No archived outcomes, fake complete/finalize/store replies,
// native session construction, filesystem salary write or signing operation.
import {readFileSync} from 'node:fs'
import {build} from 'esbuild'
const input=JSON.parse(readFileSync(process.argv[2],'utf8'))
const source=`
import {createFiscalExecutionApi,FiscalExecutionFailure} from './src/features/calculator/fiscal-execution-api';
import {prepareExternalExecution} from './src/features/calculator/prepared-external-execution';
import {createFiscalAdapter,presentInverseFiscalResult} from './src/features/calculator/fiscal-adapter';
import {calculateStandardEstimatedNetToGross} from './src/domain/payroll/net-to-gross';
import {hashObject} from './src/features/documents/evidence-v3';
export async function run(input){
 const m=JSON.parse(input.materialWire),state=input.state,request=input.request;
 let resultWire;
 if(state.version!==2||m.version!==2)throw Error('Expected fresh compat native acquisition');
 const invoke=async(command,args)=>{
  if(command==='fiscal_execution_prepare'){if(hashObject(args.request)!==hashObject(request))throw Error('Native capture swap');return state;}
  if(command==='fiscal_execution_material')return input.materialWire;
   if(command==='fiscal_execution_status')return state;
   if(command==='fiscal_execution_complete'){resultWire=args.request.resultWire;throw new FiscalExecutionFailure('CD3_NATIVE_PARENT_COMPLETE_REQUIRED');}
  throw Error('No synthetic mutation response: '+command);
 };
 const api=createFiscalExecutionApi(invoke),ref=await api.prepare(m.capture,m.scenario,m.context.selection,m.requestId,state.clientRequestId);
 const execution=await prepareExternalExecution(api,ref);
 let outcome;
 if(input.mode==='no-candidate'){
  const adapter=createFiscalAdapter(execution.provider.context,true),p=adapter.prepare(m.capture,m.scenario);
  if(!p.ok||p.prepared.mode!=='net-to-gross')throw Error('Inverse preparation required');
  const report=await calculateStandardEstimatedNetToGross({...p.prepared.input,searchOptions:{maxEvaluations:1}},execution.provider.context);
  outcome={kind:'inverse',report,presentation:presentInverseFiscalResult(report,m.capture.form.effectiveDate)};
 }else outcome=await execution.calculate();
 // Capture the real client's serialization at the process boundary. No successful
 // completion reply is synthesized: the parent performs REAL native completion.
 try{await api.complete(ref,outcome);throw Error('Unexpected synthetic completion');}catch(e){if(!(e instanceof FiscalExecutionFailure)||e.code!=='CD3_NATIVE_PARENT_COMPLETE_REQUIRED')throw e;}
 if(typeof resultWire!=='string')throw Error('Missing client completion envelope');
 return {resultWire,
   provenance:{kind:'fresh-engine-from-native-material',readTransportReplay:true,clientCompletionSerialized:true,nativeCompletionInParent:true,mutationsMocked:false,technicalSearchOptions:input.mode==='no-candidate'?{maxEvaluations:1}:null}};
}
`
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'})
const runtime=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
process.stdout.write(JSON.stringify(await runtime.run(input)))
