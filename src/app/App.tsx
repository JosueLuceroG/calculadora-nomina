import { useEffect, useMemo, useRef, useState } from "react"
import { AppShell, type AppSection } from "@/components/layout/app-shell"
import { ParameterSection, type ParameterCategory, type ParameterNavigationTarget } from "@/features/parameters/parameter-section"
import { HelpSection } from "@/features/help/help-section"
import { CaptureSection } from "@/features/calculator/components/capture-section"
import { ResultsSection } from "@/features/calculator/components/results-section"
import { CaptureSummary } from "@/features/calculator/components/capture-summary"
import { createInitialForm, fiscalFieldIds, supportedCaptureProfile, type CaptureForm, type FiscalCaptureErrors } from "@/features/calculator/form"
import { createContextualCalculationController, type CalculationController, type CalculationState } from "@/features/calculator/calculation-controller"
import type { MinimumDeclaration } from "@/features/calculator/fiscal-adapter"
import { queryFiscalDateCoverage } from "@/features/calculator/fiscal-adapter"
import { automaticDateIsStale, changeManualDate, chooseAutomaticDate, chooseManualDate, createDateSession, finishFiscalExecution, preserveResultDate, startFiscalExecution, systemClock, type CivilClock, type DateSession, type FiscalExecutionMetadata } from "@/features/calculator/date-policy"
import { FiscalDateControl } from "@/features/calculator/components/fiscal-date-control"
import { createHistoryController, type HistoryController, type HistoryState } from "@/features/history/history-controller"
import { HistorySection } from "@/features/history/history-section"
import { ThemeProvider } from "@/features/theme/theme-provider"
import { createThemeController, type ThemeController } from "@/features/theme/theme-controller"
import { createPdfExportController, type PdfExportController, type PdfExportState } from "@/features/pdf/export-controller"
import { documentFromCurrent, documentFromHistory } from "@/features/pdf/document-model"
import {documentFromPersisted} from '@/features/pdf/persisted-document'
import {CompatOutcomeDetails} from '@/features/history/compat-outcome-details'
import { PdfExportNotice } from "@/features/pdf/export-notice"
import { recordDocumentExecutionMetadata } from "@/features/documents/provenance"
import {createFiscalExecutionApi,nativeAvailable} from "@/features/calculator/fiscal-execution-api"
import type {FiscalExecutionApi,Selection} from "@/features/calculator/fiscal-execution-api"
import {createExternalCalculationController,transientExecution} from "@/features/calculator/external-calculation-controller"
import type {ExternalCalculationController} from "@/features/calculator/external-calculation-controller"
import {createExternalDocumentController,type ExternalDocumentController,type ExternalDocumentState} from "@/features/calculator/external-document-controller"
import {ExternalExecutionNotice} from "@/features/calculator/components/external-execution-notice"
import {IntegratedFiscalSourceNotice} from '@/features/parameters/fiscal-administration'
import {retryFiscalRead} from "@/features/fiscal-packages/fiscal-ui-read"

export function App({ createController = createContextualCalculationController, clock = systemClock, createHistory = createHistoryController, createTheme = createThemeController, createPdfExport = createPdfExportController }: { createController?: () => CalculationController; clock?: CivilClock; createHistory?: () => HistoryController; createTheme?: () => ThemeController; createPdfExport?: () => PdfExportController } = {}) {
  const [dateSession, setDateSession] = useState(() => createDateSession(clock()))
  const [form, setForm] = useState(() => ({ ...createInitialForm(), effectiveDate: dateSession.referenceDate }))
  const [paymentDate, setPaymentDate] = useState("")
  const area = supportedCaptureProfile.area
  const [view, setView] = useState<"capture" | "results">("capture")
  const [calculation, setCalculation] = useState<CalculationState | null>(null)
  const [captureErrors, setCaptureErrors] = useState<FiscalCaptureErrors>({})
  const controller = useRef<CalculationController | null>(null)
  const integratedController=useRef<CalculationController|null>(null)
  const externalController=useRef<ExternalCalculationController|null>(null)
  const executionApi=useRef<FiscalExecutionApi|null>(null)
  const routingEpoch=useRef(0)
  const [routing,setRouting]=useState(false)
  const externalDocuments=useRef<ExternalDocumentController|null>(null)
  const [externalDocument,setExternalDocument]=useState<ExternalDocumentState|null>(null)
  const externalAutomaticRef=useRef(true)
  const submitted = useRef(false)
  const previousView = useRef(view)
  const dateSessionRef = useRef(dateSession)
  const executionRef = useRef<FiscalExecutionMetadata | null>(null)
  const [execution, setExecution] = useState<FiscalExecutionMetadata | null>(null)
  const [staleDate, setStaleDate] = useState(false)
  const [section, setSection] = useState<AppSection>("calculator")
  const [parametersVisited, setParametersVisited] = useState(false)
  const [helpVisited, setHelpVisited] = useState(false)
  const [historyVisited, setHistoryVisited] = useState(false)
  const history=useRef<HistoryController|null>(null)
  const [historyState,setHistoryState]=useState<HistoryState|null>(null)
  const historyMutation=useRef(false)
  const pdfExport=useRef<PdfExportController|null>(null)
  const [pdfState,setPdfState]=useState<PdfExportState|null>(null)
  const [parameterTarget, setParameterTarget] = useState<ParameterNavigationTarget>()
  const navigationMemory = useRef<Record<AppSection, { scroll: number; focus: HTMLElement | null }>>({
    calculator: { scroll: 0, focus: null }, parameters: { scroll: 0, focus: null }, help: { scroll: 0, focus: null }, history: { scroll: 0, focus: null },
  })

  useEffect(() => {
    // Crear por ciclo de montaje evita reutilizar una instancia dispuesta en StrictMode.
    const current = createController()
    controller.current = current
    integratedController.current=current
    const api=createFiscalExecutionApi(),external=createExternalCalculationController(api)
    externalController.current=external
    executionApi.current=api
    const localHistory=createHistory()
    history.current=localHistory
    const unsubscribeHistory=localHistory.subscribe(setHistoryState)
    setHistoryState(localHistory.getState())
    void localHistory.initialize()
    const documents=createExternalDocumentController({consent:()=>localHistory.getState().autoSave&&localHistory.getState().preferenceStatus==='ready'&&!localHistory.getState().preferenceBusy&&!localHistory.getState().mutationBusy,onStored:()=>{if(localHistory.getState().listLoaded)void localHistory.loadFirst()}})
    externalDocuments.current=documents
    const unsubscribeDocuments=documents.subscribe(s=>{setExternalDocument(s);if(controller.current===external&&s.snapshot){executionRef.current=s.snapshot.execution;setExecution(s.snapshot.execution)}})
    setExternalDocument(documents.getState())
    const observe=(state:CalculationState,emitter:CalculationController)=>{
      if(controller.current!==emitter)return
      setCalculation(state)
      if(transientExecution(state)){executionRef.current=null;setExecution(null);if(state.phase==='calculating')documents.begin(state.requestId,localHistory.getState().preferenceStatus==='ready'&&localHistory.getState().autoSave&&!localHistory.getState().preferenceBusy&&!localHistory.getState().mutationBusy,externalAutomaticRef.current);else if(state.phase==='result'){const session=preserveResultDate(dateSessionRef.current);dateSessionRef.current=session;setDateSession(session);void documents.finish(state)}else documents.clear();return}
      if (state.phase === "calculating" && state.snapshot) {
        const date = state.snapshot.form.effectiveDate
        const next = startFiscalExecution(dateSessionRef.current, state.requestId, date, clock(), state.executionProvenance?.fiscalPackage.id ?? queryFiscalDateCoverage(date).packageId)
        recordDocumentExecutionMetadata(state,next)
        executionRef.current = next
        setExecution(next)
        localHistory.beginRun(state.requestId)
      } else if (state.phase === "result" && executionRef.current?.requestId === state.requestId) {
        const next = finishFiscalExecution(executionRef.current, clock(), executionRef.current.packageId)
        recordDocumentExecutionMetadata(state,next)
        executionRef.current = next
        setExecution(next)
        const session = preserveResultDate(dateSessionRef.current)
        dateSessionRef.current = session
        setDateSession(session)
        void localHistory.finishRun(current.getState,state.requestId,next)
      } else if (state.phase === "idle" || state.phase === "capture-error") {
        executionRef.current = null
        setExecution(null)
      }
    }
    const unsubscribe = current.subscribe(state=>observe(state,current))
    const unsubscribeExternal=external.subscribe(state=>observe(state,external))
    setCalculation(current.getState())
    return () => {
      unsubscribe()
      unsubscribeExternal()
      unsubscribeHistory()
      unsubscribeDocuments()
      documents.dispose()
      if(externalDocuments.current===documents)externalDocuments.current=null
      localHistory.dispose()
      if(history.current===localHistory)history.current=null
      current.dispose()
      external.dispose()
      routingEpoch.current++
      if (controller.current === current||controller.current===external) controller.current = null
      if(integratedController.current===current)integratedController.current=null
      if(externalController.current===external)externalController.current=null
      if(executionApi.current===api)executionApi.current=null
    }
  }, [createController, clock, createHistory])

  useEffect(()=>{const current=createPdfExport();pdfExport.current=current;const unsubscribe=current.subscribe(setPdfState);setPdfState(current.getState());return()=>{unsubscribe();current.dispose();if(pdfExport.current===current)pdfExport.current=null}},[createPdfExport])
  useEffect(()=>{const busy=Boolean(historyState?.mutationBusy);if(historyMutation.current&&!busy&&externalDocuments.current?.getState().document)void externalDocuments.current.reconcile();historyMutation.current=busy},[historyState?.mutationBusy])

  useEffect(() => {
    if (previousView.current === view) return
    previousView.current = view
    if (section !== "calculator") return
    window.scrollTo(0, 0)
    document.getElementById(view === "results" ? "results-title" : "salary")?.focus({ preventScroll: true })
  }, [view, section])

  function navigate(next: AppSection) {
    if (next === section) return
    const workspace = document.getElementById(`${section}-workspace`)
    const active = document.activeElement
    navigationMemory.current[section] = { scroll: window.scrollY,
      focus: active instanceof HTMLElement && workspace?.contains(active) ? active : navigationMemory.current[section].focus }
    if (next === "parameters") setParametersVisited(true)
    if (next === "help") setHelpVisited(true)
    if (next === "history") setHistoryVisited(true)
    setSection(next)
    requestAnimationFrame(() => {
      const saved = navigationMemory.current[next]
      const fallback = next === "parameters" ? "parameters-title" : next === "help" ? "help-title" : next === "history" ? "history-title" : view === "results" ? "results-title" : "salary"
      const focus = saved.focus?.isConnected ? saved.focus : document.getElementById(fallback)
      focus?.focus({ preventScroll: true })
      window.scrollTo(0, saved.scroll)
    })
  }

  function openHelpParameter(category: ParameterCategory) {
    setParameterTarget(previous => ({ category, token: (previous?.token ?? 0) + 1 }))
    navigate("parameters")
  }

  function updateForm(next: CaptureForm) {
    setRouting(false)
    externalDocuments.current?.clear()
    routingEpoch.current++
    submitted.current = false
    setCaptureErrors({})
    setForm(next)
    controller.current?.edit({ form: next, area })
  }
  function clear() {
    setPaymentDate("")
    setRouting(false)
    externalDocuments.current?.clear()
    routingEpoch.current++
    submitted.current = false
    controller.current?.clear()
    const session = createDateSession(clock())
    dateSessionRef.current = session
    setDateSession(session)
    setStaleDate(false)
    setForm({ ...createInitialForm(), effectiveDate: session.referenceDate })
    setCaptureErrors({})
    setView("capture")
  }
  function calculate() {
    const current = controller.current
    if (!current || submitted.current) return
    if (automaticDateIsStale(dateSessionRef.current, clock())) {
      setStaleDate(true)
      requestAnimationFrame(() => document.getElementById("effective-date")?.focus())
      return
    }
    if (!queryFiscalDateCoverage(form.effectiveDate).available) {
      requestAnimationFrame(() => document.getElementById("effective-date")?.focus())
      return
    }
    submitted.current = true
    const perform=(current:CalculationController,selected?:Selection)=>{
    if(selected?.kind==='external'&&current===externalController.current)externalController.current!.submitSelected({form,area},selected,dateSessionRef.current.mode)
    else current.submit({ form, area })
    const next = current.getState()
    if (next.phase === "capture-error") {
      const errors: FiscalCaptureErrors = {}
      for (const issue of next.captureIssues) {
        if (issue.field in fiscalFieldIds) errors[issue.field as keyof FiscalCaptureErrors] = `${issue.category === "technical" ? "Límite técnico: " : ""}${issue.message}`
      }
      setCaptureErrors(errors)
      submitted.current = false
      const first = (Object.keys(fiscalFieldIds) as (keyof FiscalCaptureErrors)[]).find(field => errors[field])
      if (first) requestAnimationFrame(() => document.getElementById(fiscalFieldIds[first])?.focus())
      return
    }
    setView("results")
    }
    if(createController===createContextualCalculationController&&nativeAvailable()&&executionApi.current){const epoch=++routingEpoch.current;setRouting(true);void retryFiscalRead(()=>executionApi.current!.source(),()=>epoch===routingEpoch.current&&submitted.current).then(selected=>{if(epoch!==routingEpoch.current||!submitted.current||!controller.current)return;setRouting(false);const target=selected.kind==='external'?externalController.current:integratedController.current;if(!target)return;const previous=controller.current;controller.current=target;if(previous!==target)previous.cancel();perform(target,selected)},error=>{if(epoch!==routingEpoch.current||!submitted.current||!externalController.current)return;setRouting(false);const previous=controller.current;controller.current=externalController.current;if(previous&&previous!==controller.current)previous.cancel();externalController.current.rejectRouting({form,area},error?.code??'SELECTION_UNAVAILABLE');setView('results')});return}
    perform(current)
  }
  function edit() {
    setRouting(false)
    externalDocuments.current?.clear()
    routingEpoch.current++
    submitted.current = false
    controller.current?.edit({ form, area })
    setView("capture")
  }
  function cancel() {
    setRouting(false)
    externalDocuments.current?.clear()
    routingEpoch.current++
    controller.current?.cancel()
    requestAnimationFrame(() => document.getElementById("results-title")?.focus({ preventScroll: true }))
  }
  function confirmMinimum(requestId: number, declaration: MinimumDeclaration) {
    const job = controller.current?.confirmMinimum(requestId, declaration)
    if (job?.accepted) requestAnimationFrame(() => document.getElementById("results-title")?.focus({ preventScroll: true }))
  }
  function updateDate(session: DateSession) {
    dateSessionRef.current = session
    setDateSession(session)
    setStaleDate(false)
    updateForm({ ...form, effectiveDate: session.referenceDate })
  }
  function exportCurrentPdf(){
     const current=controller.current,metadata=executionRef.current
    if(!current||!pdfExport.current)return
    if(transientExecution(current.getState())){const d=externalDocuments.current?.getState();if(d?.phase!=='stored'||!d.snapshot||!d.document)return;const snapshot=d.snapshot,checksum=d.document.documentSha256;void pdfExport.current.exportPdf({source:'current',getDocument:()=>documentFromPersisted(snapshot.executionId,checksum),isCurrent:()=>controller.current===current&&externalDocuments.current?.getState().snapshot===snapshot&&externalDocuments.current.getState().phase==='stored'});return}
    if(!metadata)return
    const source=current.getState(),isCurrent=()=>controller.current===current&&current.getState().phase==="result"&&current.getState().requestId===source.requestId&&current.getState().outcome===source.outcome&&executionRef.current===metadata
    void pdfExport.current.exportPdf({source:"current",getDocument:()=>documentFromCurrent(()=>source,metadata),isCurrent})
  }
  function exportHistoricalPdf(){
    const current=history.current,snapshot=current?.getSelectedOriginalForExport()
    if(!current||!snapshot||!pdfExport.current)return
    void pdfExport.current.exportPdf({source:"history",getDocument:()=>documentFromHistory(snapshot),isCurrent:()=>history.current===current&&!current.getState().mutationBusy&&current.getSelectedOriginalForExport()===snapshot})
  }
  const presentation = calculation?.phase === "result" ? calculation.outcome?.presentation : undefined
  const dateCoverage = useMemo(() => queryFiscalDateCoverage(form.effectiveDate), [form.effectiveDate])
  const dateBlocked = staleDate || dateCoverage.reason === "outside-coverage" || dateCoverage.reason === "parameters-unavailable"
   const transient=transientExecution(calculation)
   const saveNotice=calculation&&!transient?historyState?.notices[calculation.requestId]:undefined
  const saveAdornment=saveNotice?<span className={`history-save-chip history-save-${saveNotice.status}`} role="status" title={saveNotice.message} aria-label={saveNotice.message}>{saveNotice.status==="saved"?"Guardado":saveNotice.status==="saving"?"Guardando…":"No guardado"}</span>:undefined
  const exportReady=Boolean(calculation?.phase==="result"&&calculation.outcome&&calculation.snapshot&&(transient?externalDocument?.phase==='stored':execution?.completedAt&&execution.requestId===calculation.requestId))

  return (
    <ThemeProvider createController={createTheme}><AppShell section={section} onNavigate={navigate}>
      <div id="calculator-workspace" hidden={section !== "calculator"}>
      {view === "capture" ? (
        <><IntegratedFiscalSourceNotice onParameters={()=>navigate('parameters')}/>{routing&&<p role="status">Preparando el cálculo… <button type="button" onClick={()=>{routingEpoch.current++;submitted.current=false;setRouting(false)}}>Cancelar preparación</button></p>}<CaptureSection form={form} onFormChange={updateForm} onClear={clear} onValidated={calculate} paymentDate={paymentDate} onPaymentDateChange={setPaymentDate} externalErrors={captureErrors} disabled={calculation === null||routing} dateBlocked={dateBlocked} dateControl={dateError => <FiscalDateControl session={dateSession} coverage={dateCoverage} error={dateError} stale={staleDate} onAutomatic={() => updateDate(chooseAutomaticDate(dateSession, clock()))} onManual={() => updateDate(chooseManualDate(dateSession, dateCoverage.available))} onChange={date => updateDate(changeManualDate(dateSession, date))} />} /></>
      ) : (
        <div className="results-view">
          <CaptureSummary form={calculation?.snapshot?.form ?? form} area={calculation?.snapshot?.area ?? area} paymentDate={paymentDate} onEdit={edit} onClear={clear} execution={calculation?.phase === "result" && execution?.requestId === calculation.requestId ? execution : undefined} statusText={calculation?.phase === "calculating" ? "Calculando bruto… La captura se conserva." : "Estimación estándar 2026 · Datos declarados."} statusAdornment={saveAdornment}/>
          {transient&&<ExternalExecutionNotice execution={transient} document={externalDocument} consent={Boolean(historyState?.autoSave)} save={()=>void externalDocuments.current?.store('manual')} reconcile={()=>void externalDocuments.current?.reconcile()}/>}
          {saveNotice?.status==="error"&&<p className="history-save-error" role="alert">{saveNotice.message}</p>}
          <ResultsSection mode={form.mode} period={form.period} phase={calculation?.phase} onCancel={cancel} presentation={presentation} report={calculation?.phase === "result" ? calculation.outcome?.report : undefined} error={calculation?.error?.message} requestId={calculation?.requestId} onConfirmMinimum={confirmMinimum} onExportPdf={exportReady?exportCurrentPdf:undefined} exportBusy={pdfState?.busy} hideExportPdf={Boolean(transient&&!exportReady)}/>
          {transient&&calculation?.phase==='result'&&calculation.outcome&&calculation.snapshot&&<CompatOutcomeDetails key={calculation.requestId} outcome={calculation.outcome} date={calculation.snapshot.form.effectiveDate} current/>}
        </div>
      )}
      </div>
      {parametersVisited && <div id="parameters-workspace" hidden={section !== "parameters"}>
        <ParameterSection referenceDate={form.effectiveDate} simulationPackage={transient?.context?`${transient.context.packageId} · ${transient.context.parameterVersion}`:execution?.packageId ?? null} navigationTarget={parameterTarget} />
      </div>}
      {helpVisited && <div id="help-workspace" hidden={section !== "help"}><HelpSection onOpenParameters={openHelpParameter} /></div>}
      {historyVisited&&<div id="history-workspace" hidden={section!=="history"}><HistorySection controller={history.current} state={historyState} active={section==="history"} onExportPdf={exportHistoricalPdf} exportBusy={pdfState?.busy}/></div>}
      <PdfExportNotice state={pdfState} onDismiss={()=>pdfExport.current?.dismiss()}/>
    </AppShell></ThemeProvider>
  )
}
