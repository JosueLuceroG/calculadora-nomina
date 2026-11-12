import {loadLocalPdfFonts} from "./font-loader"
import {renderSalaryReport} from "./render-report"
export async function loadReportRuntime(){const fonts=await loadLocalPdfFonts();return{render:(report:Parameters<typeof renderSalaryReport>[0])=>renderSalaryReport(report,fonts)}}
