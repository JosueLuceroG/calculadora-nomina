import type { ReactNode } from "react"
import {
  Calculator,
  CalendarDays,
  CircleHelp,
  History,
  Settings,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/features/theme/theme-provider"
import { version } from "../../../package.json"

export type AppSection = "calculator" | "parameters" | "help" | "history"
export function AppShell({ children, section = "calculator", onNavigate }: { children: ReactNode; section?: AppSection; onNavigate?: (section: AppSection) => void }) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Barra lateral">
        <div className="brand">
          <Calculator aria-hidden="true" strokeWidth={2.4} />
          <span>Calculadora<br />de Nómina</span>
        </div>

        <nav className="sidebar-nav" aria-label="Navegación principal">
          <Button type="button" variant="ghost" className={`nav-item${section === "calculator" ? " nav-item-active" : ""}`} aria-current={section === "calculator" ? "page" : undefined} onClick={() => onNavigate?.("calculator")} disabled={!onNavigate}>
            <Calculator /> Calcular
          </Button>
          <Button type="button" variant="ghost" className={`nav-item${section === "history" ? " nav-item-active" : ""}`} aria-current={section === "history" ? "page" : undefined} onClick={() => onNavigate?.("history")} disabled={!onNavigate}>
            <History /> Historial
          </Button>
          <Button type="button" variant="ghost" className={`nav-item${section === "parameters" ? " nav-item-active" : ""}`} aria-current={section === "parameters" ? "page" : undefined} onClick={() => onNavigate?.("parameters")} disabled={!onNavigate}>
            <Settings /> Parámetros
          </Button>
          <Button type="button" variant="ghost" className={`nav-item${section === "help" ? " nav-item-active" : ""}`} aria-current={section === "help" ? "page" : undefined} onClick={() => onNavigate?.("help")} disabled={!onNavigate}>
            <CircleHelp /> Ayuda
          </Button>
        </nav>

        <div className="sidebar-footer">
          <ThemeToggle />
          <span className="version">v{version} · Simulación 2026</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            <h1>Calculadora de Nómina</h1>
            <p>Simula tu sueldo bruto o neto con base en las disposiciones fiscales vigentes.</p>
          </div>
          <div className="demo-badge" role="note">
            <CalendarDays aria-hidden="true" />
            <div><strong>Simulación fiscal</strong><span>México 2026 · Estimada</span></div>
          </div>
        </header>
        <div className="content-sections">{children}</div>
      </main>
    </div>
  )
}
