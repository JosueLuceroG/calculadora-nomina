# Calculadora de Nómina

Estimación local de nómina mexicana 2026 para Windows, con cálculo directo e inverso, aritmética decimal exacta, historial local y reportes PDF.

![Versión](https://img.shields.io/badge/versi%C3%B3n-0.1.1--rc.1-blue)
![Plataforma](https://img.shields.io/badge/Windows-11%20x64-0078D4)
![Licencia](https://img.shields.io/badge/licencia-MIT-green)
![Distribución](https://img.shields.io/badge/distribuci%C3%B3n-NO--GO-red)

> **Estado:** candidato `0.1.1-rc.1` para validación controlada. La distribución general está en **NO-GO**: el instalador no tiene firma Authenticode, no se ejecutó una instalación en Windows limpio y la revisión fiscal D1–D5 sigue pendiente. Esta aplicación **no es CFDI** ni un cálculo certificado u homologado con SUA/CONTPAQi.

## Qué es

Calculadora de Nómina es una aplicación de escritorio que estima el bruto y el neto de un recibo ordinario bajo un perfil fiscal declarado. Todo el cálculo ocurre en el equipo: no requiere una cuenta, un servidor ni una conexión a internet después de instalar el runtime de Windows.

El proyecto separa explícitamente tres cosas que suelen mezclarse:

1. **Datos fiscales oficiales** del ejercicio 2026, con vigencia, fuente, versión y hash.
2. **Políticas de simulación** versionadas: redondeos, supuestos, límites y advertencias.
3. **Presentación y persistencia**, que no reconstruyen fórmulas ni modifican resultados.

## Capturas

Las imágenes corresponden al build `0.1.1-rc.1` y usan datos ficticios.

<table>
  <tr>
    <td><img src="docs/screenshots/00-inicio.png" alt="Pantalla inicial" width="420"></td>
    <td><img src="docs/screenshots/01-bruto-a-neto.png" alt="Resultado bruto a neto" width="420"></td>
  </tr>
  <tr>
    <td align="center">Captura inicial</td>
    <td align="center">Bruto a neto: 15,000.00 → 13,202.64</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/02-neto-a-bruto.png" alt="Resultado neto a bruto" width="420"></td>
    <td><img src="docs/screenshots/05-historial.png" alt="Historial local" width="420"></td>
  </tr>
  <tr>
    <td align="center">Neto a bruto: 13,202.64 → 15,000.00</td>
    <td align="center">Historial local con datos ficticios</td>
  </tr>
</table>

También están disponibles las vistas completas de [Parámetros](docs/screenshots/03-parametros.png), [Ayuda](docs/screenshots/04-ayuda.png) y [Historial](docs/screenshots/05b-historial-completo.png), además de un [reporte PDF de ejemplo](docs/ejemplos/reporte-ejemplo.pdf).

## Capacidades

| Área | Implementación |
| --- | --- |
| Cálculo directo | Bruto ordinario → IMSS → ISR → subsidio → neto estimado |
| Cálculo inverso | Neto objetivo → bruto mínimo demostrado, alternativas y cobertura |
| Precisión | `decimal.js` con contexto de 50 dígitos; importes monetarios a centavos con half-up |
| Desglose | Salario diario, factor de integración, SDI, SBC, ISR, subsidio, IMSS por ramo y neto |
| Historial | SQLite local, snapshots originales, detalle sin recalcular y borrado confirmado |
| PDF | jsPDF + AutoTable con DejaVu Sans embebida; exporta el resultado vigente o el snapshot histórico |
| Parámetros | Tarifas ISR 2026, UMA, subsidio, mínimos, cuotas IMSS y fuentes oficiales |
| Temas | Claro y oscuro, con preferencia local |
| Red | Sin servicios externos en ejecución; CSP limitado a `self` e IPC local |

## Cómo calcula

El flujo directo es una composición de módulos independientes. Ningún componente React ejecuta fórmulas: la interfaz envía una captura explícita al adaptador fiscal y el controlador administra solicitudes, cancelación y respuestas obsoletas.

1. **Integración salarial.** Se obtiene el salario diario contractual, el factor de integración y el SDI teórico. Las prestaciones se declaran; no se infieren.
2. **SBC estimado.** Se aplican los límites legales de la zona general y se redondea a centavos. El resultado es una estimación, no un SBC registrado.
3. **Cuotas obreras IMSS.** Se calculan cinco ramos con la base estimada, días de referencia 7/15/30 y redondeo half-up por ramo antes de sumar.
4. **ISR por tarifa.** La base es el bruto ordinario del periodo sin descontar IMSS. Se selecciona el tramo inclusivo en centavos y se aplica la tarifa semanal, quincenal o mensual.
5. **Subsidio al empleo.** Se estima la referencia mensual, se determina la cuota y se aplica contra el ISR. El excedente no se paga ni se traslada.
6. **Retención y neto.** Se separa ISR por tarifa, subsidio aplicado, ISR provisional y neto. El neto resta únicamente la retención estimada y el IMSS descontado.
7. **Inverso.** Se buscan centavos de bruto en intervalos disjuntos, ejecutando siempre el cálculo directo. Se publican coincidencia exacta, aproximación, cobertura y presupuesto agotado por separado.

### Ejemplos de control

| Caso | Resultado |
| --- | --- |
| Mensual 15,000.00, prestaciones 15/12/25, IMSS sí | **13,202.64** |
| Mensual 15,000.00, prestaciones 15/12/25, IMSS no | **13,597.18** |
| Semanal 3,500.00 | **3,076.67** |
| Quincenal 7,500.00 | **6,592.87** |
| Inverso exacto de 13,202.64 mensual | **15,000.00** |

Los importes son estimaciones bajo el perfil declarado. La conciliación mensual real, los ingresos variables o exentos, las incidencias y otros patrones quedan fuera de alcance.

### Políticas versionadas

El motor no oculta sus decisiones en constantes dispersas. Cada regla relevante tiene un identificador y una política explícita:

- `decimal-50-v1` para precisión y redondeo.
- `standard-isr-tariff-2026-final-half-up-v1` para tarifa e ISR final.
- `standard-worker-imss-general-2026-half-up-per-branch-v1` para cuotas obreras.
- `estimated-sbc-general-2026-half-up-v1` para SBC estimado.
- `standard-isr-withholding-2026-monthly-minimum-explicit-assumption-v1` para retención y mínimo.
- `standard-net-to-gross-2026-certified-intervals-v1` para la búsqueda inversa.
- `theoretical-fixed-integration-2026-v1` para integración salarial.
- `standard-estimate-2026-v1` para las convenciones generales del simulador.

El detalle matemático, las fórmulas, los órdenes de redondeo y los límites están en [MOTOR-DE-CALCULO.md](docs/MOTOR-DE-CALCULO.md).

## Años fiscales y paquetes firmados

El build `0.1.1-rc.1` incluye **solo el ejercicio 2026**. No descarga años fiscales desde internet y no reemplaza silenciosamente una fecha de 2027.

La arquitectura sí contempla paquetes fiscales firmados para incorporar parámetros de otros ejercicios:

- Formato `mx.nomina.fiscal-package`, versión 1, canonicalización RFC 8785.
- Firma Ed25519 con firmas separadas por dominio.
- Tres claves raíz y umbral 2-de-3.
- Separación entre canal QA y producción; una clave QA no puede usarse en producción.
- Verificación de integridad, autenticación, aprobación editorial, datos fiscales y compatibilidad con el motor compilado.
- Activación por sesión, con nonce, timeout absoluto y reconciliación posterior.

**Importante:** el backend de importación, verificación y activación existe, pero las pantallas de paquetes fiscales **no están montadas en la interfaz de `0.1.1-rc.1`**. La versión publicada muestra “Esta versión no ofrece importación manual de parámetros.” No se debe presentar esta capacidad como disponible al usuario final.

El diseño completo, el modelo de confianza y el estado real están en [PAQUETES-FISCALES.md](docs/PAQUETES-FISCALES.md).

## Privacidad y seguridad

- **Datos locales:** historial y preferencias viven en `%LOCALAPPDATA%\mx.calculadoranomina.desktop\payroll.sqlite3`.
- **Sin cifrado:** la base local no está cifrada. La interfaz lo advierte.
- **Guardado automático:** empieza desactivado en un perfil nuevo. Desactivarlo no borra registros.
- **PDF:** se guardan en la carpeta que el usuario elija; las fuentes están embebidas localmente.
- **Red:** en los flujos verificados se observaron 95 solicitudes de página y 0 externas. Es evidencia de esos flujos, no una auditoría absoluta de la telemetría del sistema operativo o de WebView2.
- **Enlaces oficiales:** solo se abren por acción del usuario, mediante HTTPS y hosts de autoridades permitidas.
- **CSP:** `default-src 'self'`, `font-src 'self'`, `connect-src ipc: http://ipc.localhost`.
- **Instalador:** no está firmado. Windows puede mostrar SmartScreen o “editor desconocido”.

No se incluyen claves privadas, certificados de producción ni credenciales en el repositorio. Las claves de QA son externas al proyecto y los PEM temporales se eliminan.

## Requisitos

**Para usar la aplicación**

- Windows 11 x64, cuenta de usuario estándar.
- Microsoft Edge WebView2 Evergreen Runtime.
- Pantalla que permita una ventana de al menos 900 × 600 unidades lógicas.
- El instalador compacto requiere internet si falta WebView2; la variante offline lo embebe.

**Para desarrollar**

- Node.js y npm.
- Rust con destino `x86_64-pc-windows-msvc`.
- Visual Studio Build Tools con herramientas de C++ y Windows SDK.
- WebView2 Runtime.

## Desarrollo

```powershell
npm install
npm run dev
```

La interfaz de desarrollo queda en `http://127.0.0.1:1420/`. Para abrir la aplicación Tauri completa:

```powershell
npm run tauri -- dev
```

Comprobaciones principales:

```powershell
npm run typecheck
npm test
npm run build
cargo test --manifest-path "src-tauri/Cargo.toml" --lib
cargo test --manifest-path "crates/nomina-fiscal-package/Cargo.toml"
```

En este corte, `npm run typecheck`, `npm test` y `npm run build` están verificados. La suite de Vitest reporta **5,903 pruebas aprobadas**. Los tests Rust están verificados: **291 aprobadas y 10 ignoradas** en `src-tauri`, y **32 aprobadas** en `crates/nomina-fiscal-package`; **0 fallos**.

## Construcción e instaladores

El repositorio no incluye binarios. Los instaladores se generan localmente y se publican, cuando corresponda, con su hash y su estado de firma.

Variante compacta:

```powershell
npm run tauri -- build --config src-tauri/tauri.release.conf.json --bundles nsis --no-sign --ci -- --locked --offline --no-default-features
```

Variante offline:

```powershell
npm run tauri -- build --config src-tauri/tauri.offline.conf.json --bundles nsis --no-sign --ci -- --locked --offline --no-default-features
```

Los hashes, tamaños, requisitos y bloqueos del candidato actual están en [INSTALADORES.md](docs/INSTALADORES.md). **No se debe distribuir ningún instalador como release oficial mientras siga sin firma y sin aprobación fiscal.**

## Estructura del proyecto

```text
src/
  app/                    composición principal y estilos
  components/             layout y componentes de interfaz
  domain/payroll/         contratos, aritmética decimal y motor fiscal
  features/
    calculator/           captura, adaptador, controlador y resultados
    documents/            productores documentales versionados
    fiscal-packages/      UI y API de paquetes fiscales (no montada)
    help/                 ayuda contextual
    history/              historial local y detalle original
    parameters/           catálogo fiscal de lectura
    pdf/                  modelo, render, fuentes y exportación
    storage/              API nativa, codec y snapshots
    theme/                tema claro/oscuro
  infrastructure/fiscal/  parámetros 2026, fuentes y providers
  tests/                  suite de integración y regresión
src-tauri/                contenedor Windows, comandos y persistencia
crates/nomina-fiscal-package/  verificación y confianza de paquetes
tools/fiscal-editorial/   CLI de construcción, firma y verificación
dev/                      páginas aisladas de verificación
docs/                     documentación y ejemplos
```

La descripción por capas, los límites de confianza y el flujo de datos están en [ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Estado de verificación

| Comprobación | Estado |
| --- | --- |
| `npm run typecheck` | PASS |
| Vitest | 5,903 / 5,903 PASS |
| `npm run build` | PASS |
| Tests Rust | 323 PASS; 0 FAIL; 10 ignorados |
| Actualización 0.1.0 → 0.1.1-rc.1 | PASS |
| Instalación en Windows limpio | NOT RUN |
| Firma Authenticode | NotSigned |
| Revisión fiscal D1–D5 | PENDING |
| Distribución general | **NO-GO** |

## Limitaciones

- Solo ejercicio 2026 y zona general.
- Solo salario ordinario fijo totalmente gravado.
- Periodos estándar de 7, 15 y 30 días.
- Sin CFDI, SUA, CONTPAQi ni conciliación mensual real.
- Sin ingresos variables, exentos, incidencias, otros patrones o SBC mixto.
- Sin IMSS manual, pago fiscal diario independiente ni 2027.
- “IMSS No” no representa una exención legal.
- El inverso demuestra resultados solo dentro del dominio y la cobertura informados.
- La base local no está cifrada.
- El instalador actual no está firmado.

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md)
- [Motor de cálculo](docs/MOTOR-DE-CALCULO.md)
- [Paquetes fiscales](docs/PAQUETES-FISCALES.md)
- [Instaladores](docs/INSTALADORES.md)
- [Reporte PDF de ejemplo](docs/ejemplos/reporte-ejemplo.pdf)

## Licencia

MIT. Consulta [LICENSE](LICENSE).

Las fuentes DejaVu Sans incluidas conservan su propia licencia en `src/features/pdf/assets/LICENSE-DejaVu.txt`.
