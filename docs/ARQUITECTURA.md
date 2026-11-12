# Arquitectura

Este documento describe cómo está organizada Calculadora de Nómina, qué límites separan sus capas y qué garantías —y qué no garantiza— cada una. El objetivo no es solo explicar carpetas, sino dejar claro dónde vive la autoridad de cálculo, dónde se persisten los datos y qué código puede cambiar un resultado.

## Principios de diseño

1. **Una sola autoridad de cálculo.** Las fórmulas viven en `src/domain/payroll/`. Los componentes React no ejecutan motores ni reconstruyen fórmulas.
2. **Datos, políticas y presentación separados.** Los parámetros fiscales oficiales no se mezclan con las convenciones del simulador ni con el formato de la interfaz.
3. **Exactitud antes que presentación.** Los importes se conservan como cadenas decimales y se redondean solo en los puntos definidos por cada política.
4. **La persistencia conserva, no recalcula.** Un snapshot histórico se lee tal como se guardó.
5. **La confianza es explícita.** Un paquete fiscal no es confiable por su formato: debe superar integridad, autenticación, aprobación editorial, datos y compatibilidad.
6. **El runtime no descarga datos fiscales.** La aplicación no consulta servicios externos para calcular. Los enlaces oficiales solo se abren por acción del usuario.
7. **Las capacidades no expuestas no se presentan como disponibles.** El backend fiscal existe, pero la UI de importación/activación no está montada en `0.1.1-rc.1`.

## Vista general

```text
┌─────────────────────────────────────────────────────────────┐
│ Presentación                                                │
│ src/app · src/components · src/features/calculator          │
│ Captura, resultados, historial, parámetros, ayuda, PDF      │
└──────────────────────────────┬──────────────────────────────┘
                               │ adaptador + controlador
┌──────────────────────────────▼──────────────────────────────┐
│ Dominio                                                     │
│ src/domain/payroll                                          │
│ Integración · SBC · IMSS · ISR · subsidio · directo/inverso │
└──────────────────────────────┬──────────────────────────────┘
                               │ parámetros y políticas
┌──────────────────────────────▼──────────────────────────────┐
│ Infraestructura fiscal                                      │
│ src/infrastructure/fiscal                                   │
│ Parámetros 2026 · fuentes · providers · capacidades         │
└──────────────────────────────┬──────────────────────────────┘
                               │ IPC tipado
┌──────────────────────────────▼──────────────────────────────┐
│ Backend Tauri                                               │
│ src-tauri/src                                               │
│ Storage SQLite · archivos · PDF probe · fuentes oficiales   │
│ fiscal_import · fiscal_activation · fiscal_repository       │
└──────────────────────────────┬──────────────────────────────┘
                               │ crate nativo
┌──────────────────────────────▼──────────────────────────────┐
│ Paquetes fiscales                                           │
│ crates/nomina-fiscal-package                                │
│ Canonicalización · hashes · firmas · confianza · compat.    │
└─────────────────────────────────────────────────────────────┘
```

## Presentación

La composición principal está en `src/app/App.tsx`. La navegación mantiene montadas las vistas de cálculo, parámetros y ayuda para conservar captura, fecha, selección, undo/redo y resultados pendientes. El historial y los documentos se abren como vistas independientes.

Puntos relevantes:

- `src/features/calculator/fiscal-adapter.ts` construye la entrada fiscal explícita y ejecuta el motor. Es la puerta entre la interfaz y el dominio.
- `src/features/calculator/calculation-controller.ts` administra solicitudes, snapshots inmutables, `AbortController`, cancelación y respuestas obsoletas.
- `src/features/calculator/form.ts`, `validation.ts`, `results.ts` y `format.ts` se ocupan de captura, validación de entrada, presentación y formato MXN, no de reglas fiscales.
- `src/features/parameters/` ofrece un catálogo de lectura con fuentes, vigencias y hashes.
- `src/features/help/` explica el flujo sin duplicar tablas normativas.
- `src/features/theme/` mantiene la preferencia tipada de tema.
- `src/features/fiscal-packages/` contiene la UI y la API de paquetes fiscales. **No está montada en `App.tsx` en `0.1.1-rc.1`.**

La regla de dependencia es unidireccional: presentación → adaptador/controlador → dominio. El dominio no importa React, Tauri ni componentes.

## Dominio

`src/domain/payroll/` contiene contratos, aritmética y políticas. Los módulos principales son:

| Módulo | Responsabilidad |
| --- | --- |
| `money.ts` | Decimal exacto, validación, comparación, redondeo y representación monetaria |
| `salary-integration.ts` | Salario diario contractual, factor de integración y SDI teórico |
| `sbc.ts` | SBC estimado con límites legales de zona general |
| `worker-imss.ts` | Cinco ramos obreros, absorción LSS 36 y conciliación |
| `isr-tariff.ts` | Tarifa 2026, tramo inclusivo y redondeo final |
| `employment-subsidy.ts` | Elegibilidad, cuota, aplicación y excedente |
| `gross-to-net.ts` | Composición directa y neto estimado |
| `net-to-gross.ts` | Búsqueda inversa por intervalos disjuntos |
| `net-to-gross-certificate.ts` | Condiciones del certificado matemático |
| `parameters.ts` | Tipos, autoridades, fuentes y vigencias |
| `simulation-conventions.ts` | Convenciones declaradas del simulador |

Cada política relevante expone un identificador versionado. Los detalles matemáticos están en [MOTOR-DE-CALCULO.md](MOTOR-DE-CALCULO.md).

## Infraestructura fiscal

`src/infrastructure/fiscal/` conecta el dominio con los datos disponibles:

- `2026.ts` y `parameters/2026/isr.json`: parámetros embebidos del ejercicio.
- `sources.ts`: fuentes oficiales, autoridades y hashes.
- `embedded-2026-provider.ts`: proveedor de los datos integrados.
- `external-provider.ts`: límite para datos externos, sin descarga en runtime.
- `package-provider.ts` y `package-registry.ts`: proveedores de paquetes.
- `engine-capabilities.ts`: capacidades declaradas del motor.
- `document-producer*.json` y `embedded-document-policy.json`: productores documentales versionados.

El build `0.1.1-rc.1` usa el proveedor embebido. No hay una ruta de descarga automática de años fiscales.

## Persistencia

La persistencia se divide en dos capas:

1. **Frontend tipado:** `src/features/storage/storage-api.ts`, `snapshot.ts`, `serialization.ts` y `document-dispatch.ts`.
2. **Backend SQLite:** `src-tauri/src/storage/`, con comandos específicos. React no ejecuta SQL ni recibe acceso general al sistema de archivos.

El codec es `nomina-json-v1`. Cada registro conserva el reporte completo, la captura original, un UUID estable, la referencia y hash fiscal y la huella del motor. Un valor `null` se distingue de cero.

Ubicación de la base:

```text
%LOCALAPPDATA%\mx.calculadoranomina.desktop\payroll.sqlite3
```

La base no está cifrada. El guardado automático empieza desactivado en un perfil nuevo. Desactivarlo no elimina registros. La desinstalación conserva la base salvo que se marque “Eliminar los datos de aplicación”.

## Documentos y PDF

El flujo documental está separado del cálculo:

- `src/features/pdf/document-model.ts` define el modelo documental. El origen puede ser `current`, `history` o `verified-fixture`.
- `src/features/pdf/render-report.ts` compone el PDF.
- `src/features/pdf/export-controller.ts` coordina `createSalaryReport`, `createPdfExportController` y `savePdfReport`.
- `src/features/pdf/font-loader.ts` carga DejaVu Sans local.
- `src/features/documents/` contiene los productores documentales versionados y el despacho por versión.

Un PDF exportado desde Historial conserva el snapshot original y lo etiqueta como “Historial original”; no recalcula. Un PDF desde el resultado vigente usa el resultado actual. El ejemplo del repositorio se generó con datos ficticios y el controlador real, sustituyendo únicamente el guardado nativo.

## Backend Tauri

`src-tauri/src/lib.rs` registra los comandos y módulos. Las áreas principales son:

- `storage/`: persistencia SQLite y consultas.
- `official_sources.rs`: apertura validada de enlaces oficiales.
- `appearance.rs` y `window_layout.rs`: tema y geometría de ventana.
- `pdf_probe.rs`: sonda de PDF.
- `fiscal_import/`, `fiscal_activation/`, `fiscal_execution/` y `fiscal_repository/`: ciclo de vida de paquetes fiscales.

Las features `fiscal-import-qa` y `fiscal-production` son mutuamente excluyentes. `lib.rs` contiene un `compile_error!` que impide compilar ambas a la vez. La validación de entorno QA se ejecuta en `fiscal_import::host_context::validate_qa_environment`.

## Paquetes fiscales

El crate `crates/nomina-fiscal-package` es nativo y no tiene dependencias de Tauri, SQL, red, reloj implícito ni firma privada. Sus módulos cubren:

- `canonical`, `strict_json`, `wire`: formato y serialización.
- `hashes`, `signature`: integridad y firmas.
- `trust`: claves raíz y estado confiable.
- `verify`: pipeline de verificación.
- `compatibility`: compatibilidad con el motor compilado.
- `validation_2026`, `revisions`: datos y revisiones.
- `limits`, `errors`, `time`: límites, errores y tiempo explícito.

El diseño de confianza, el formato y la activación están en [PAQUETES-FISCALES.md](PAQUETES-FISCALES.md).

## Límites de confianza

| Límite | Qué cruza | Qué no cruza |
| --- | --- | --- |
| React → dominio | Captura explícita y contexto fiscal | SQL, archivos, claves, red |
| Frontend → Tauri | Comandos IPC tipados | Acceso general al sistema |
| Paquete → aplicación | Datos y firmas verificables | Confianza implícita por formato |
| QA → producción | Separación por canal y claves | Reutilización de claves QA |
| Snapshot → PDF | Datos guardados | Recálculo o reconciliación |

La CSP de `src-tauri/tauri.conf.json` limita la página a `'self'` y a `ipc: http://ipc.localhost`. No hay `connect-src` externo.

## Pruebas

- **Vitest:** suite de dominio, integración, UI, documentos, almacenamiento y regresión. En este corte: 5,903 pruebas aprobadas.
- **Rust:** pruebas del crate fiscal y del backend. En este corte: **291 aprobadas y 10 ignoradas** en `src-tauri`, y **32 aprobadas** en `crates/nomina-fiscal-package`; **0 fallos**.
- **Páginas de desarrollo:** `dev/history.html`, `dev/inverse.html`, `dev/money.html`, `dev/pdf.html`, `dev/results.html` y `dev/storage.html` permiten verificar flujos aislados con fixtures ficticios.
- **Verificación visual:** capturas Playwright contra el build release y contra páginas de desarrollo.

## Construcción

El frontend se compila con Vite y TypeScript. El contenedor Windows se construye con Tauri 2. Los instaladores se generan con NSIS y no se incluyen en el repositorio.

Comandos de referencia:

```powershell
npm run typecheck
npm test
npm run build
npm run tauri -- dev
```

Los detalles de empaquetado, hashes y bloqueos están en [INSTALADORES.md](INSTALADORES.md).

## Brechas conocidas

- La UI de paquetes fiscales no está montada.
- Solo existe cobertura fiscal 2026.
- La instalación en Windows limpio no se ejecutó.
- El instalador no está firmado.
- La revisión fiscal D1–D5 sigue pendiente.
- La base local no está cifrada.
- No hay updater ni descarga automática de años fiscales.
