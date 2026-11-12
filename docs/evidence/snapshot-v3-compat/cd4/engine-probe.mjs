// Fresh CD-4 native acquisition -> real engine/client serialization. Native
// mutations occur in the original Rust process, never in a successful mock.
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
 const m=JSON.parse(input.materialWire),state=input.state,request=input.request;let resultWire;
 const invoke=async(command,args)=>{
  if(command==='fiscal_execution_prepare'){if(hashObject(args.request)!==hashObject(request))throw Error('Capture swap');return state;}
  if(command==='fiscal_execution_material')return input.materialWire;
  if(command==='fiscal_execution_status')return state;
  if(command==='fiscal_execution_complete'){resultWire=args.request.resultWire;throw new FiscalExecutionFailure('CD4_PARENT_NATIVE_COMPLETE');}
  throw Error('No synthetic mutation reply: '+command);
 };
 const api=createFiscalExecutionApi(invoke),ref=await api.prepare(m.capture,m.scenario,m.context.selection,m.requestId,state.clientRequestId,input.referenceMode);
 const execution=await prepareExternalExecution(api,ref);let outcome;
 const options=input.mode==='no-candidate'?{maxEvaluations:1}:input.mode==='complete-inverse'?{grossRange:{from:'15000.00',to:'15000.00'}}:input.mode==='limited-candidate'?{grossRange:{from:'15000.00',to:'15001.00'},maxEvaluations:2}:null;
 if(options){
  const p=createFiscalAdapter(execution.provider.context,true).prepare(m.capture,m.scenario);
  if(!p.ok||p.prepared.mode!=='net-to-gross')throw Error('Inverse required');
  const report=await calculateStandardEstimatedNetToGross({...p.prepared.input,searchOptions:options},execution.provider.context);
  outcome={kind:'inverse',report,presentation:presentInverseFiscalResult(report,m.capture.form.effectiveDate)};
 }else outcome=await execution.calculate();
 try{await api.complete(ref,outcome);throw Error('Synthetic completion');}catch(e){if(!(e instanceof FiscalExecutionFailure)||e.code!=='CD4_PARENT_NATIVE_COMPLETE')throw e;}
 if(typeof resultWire!=='string')throw Error('No result serialization');
 return {resultWire,provenance:{freshEngine:true,clientSerializer:true,mutationsMocked:false,technicalSearchOptions:options}};
}
`
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'})
const runtime=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
process.stdout.write(JSON.stringify(await runtime.run(input)))
