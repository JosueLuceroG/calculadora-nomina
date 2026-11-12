import {createFiscalAdapter,fiscalCaptureFingerprint} from './fiscal-adapter'
import type {FiscalExecutionApi,PreparedExecution} from './fiscal-execution-api'
import {FiscalExecutionFailure} from './fiscal-execution-api'
import {createExternalFiscalProvider} from '../../infrastructure/fiscal/external-provider'
/** Owns a native-issued request, not a caller's JSON context. Shared by the
 * asynchronous controller and the real-IPC integration harness. */
export async function prepareExternalExecution(api:FiscalExecutionApi,reference:PreparedExecution){
 const provider=await createExternalFiscalProvider(api,reference),m=provider.material,runner=createFiscalAdapter(provider.context,true),prepared=runner.prepare(m.capture,m.scenario)
 if(!prepared.ok)throw new FiscalExecutionFailure(prepared.issues[0]?.code??'INVALID_CAPTURE')
 const request=prepared.prepared
 if(request.mode!==m.context.operation||fiscalCaptureFingerprint(request.snapshot)!==fiscalCaptureFingerprint(m.capture))throw new FiscalExecutionFailure('EXECUTION_CONTEXT_MISMATCH')
 return Object.freeze({provider,reference,async calculate(signal?:AbortSignal){await api.status(reference);if(signal?.aborted)throw new FiscalExecutionFailure('CANCELLED');const outcome=request.mode==='gross-to-net'?runner.direct(request):await runner.inverse(request,signal);if(signal?.aborted)throw new FiscalExecutionFailure('CANCELLED');return outcome}})
}
