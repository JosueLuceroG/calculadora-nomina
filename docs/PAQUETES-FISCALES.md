# Paquetes fiscales

Este documento describe el diseño de los paquetes fiscales firmados: qué son, qué verifican, cómo se activan y qué parte está realmente expuesta en `0.1.1-rc.1`. También deja explícito el límite actual: **el backend existe, pero la interfaz de importación y activación no está montada en esta versión.**

## Qué problema resuelve

Los parámetros fiscales cambian por ejercicio y por publicación oficial. Una aplicación que solo incluye datos embebidos obliga a publicar una versión nueva del binario para cada cambio. Un paquete firmado permite distribuir datos y políticas de forma separada, siempre que la aplicación pueda demostrar:

1. Que el paquete no fue alterado.
2. Que fue firmado por una identidad autorizada.
3. Que existe aprobación editorial para publicarlo.
4. Que los datos corresponden al ejercicio y esquema esperados.
5. Que el motor compilado puede ejecutarlos sin cambiar su significado.

El paquete no es un archivo de configuración ni un simple JSON firmado. Es un contenedor con manifiesto, contenido, firmas y metadatos de publicación.

## Estado en 0.1.1-rc.1

| Elemento | Estado |
| --- | --- |
| Datos fiscales 2026 embebidos | Disponible |
| Backend de importación | Implementado |
| Backend de verificación | Implementado |
| Backend de activación | Implementado |
| UI de importación | **No montada** |
| UI de activación | **No montada** |
| Descarga desde internet | No implementada |
| Paquete de producción | No incluido |
| Años fiscales distintos de 2026 | No soportados |

La aplicación muestra: “Esta versión no ofrece importación manual de parámetros.” No se debe documentar ni anunciar la importación fiscal como una función disponible para el usuario final de este build.

## Formato

| Dato | Valor |
| --- | --- |
| Formato | `mx.nomina.fiscal-package` |
| Versión de formato | `1` |
| Canonicalización | RFC 8785 (JCS) |
| Versión de manifiesto | `1` |
| Capacidades requeridas | 1 a 2 |
| Firma | Ed25519 |
| Hash de contenido | SHA-256 |
| Codificación | JSON estricto, sin duplicados ni ambigüedades |

El contenedor incluye, como mínimo:

- **Manifiesto:** formato, versión, revisión, flujo, epoch de confianza, capabilities y metadatos de publicación.
- **Contenido:** parámetros, políticas y datos del ejercicio.
- **Firmas:** firmas separadas por dominio sobre el payload canónico.
- **Identidades:** hash del contenido, hash del payload firmado, hash del contenedor y huella del motor.

### Canales

| Canal | Uso |
| --- | --- |
| `Qa` | Ensayo, pruebas y validación controlada |
| `Production` | Distribución real |

Una clave de QA no puede usarse en producción. El backend rechaza ese caso con `QA_KEY_FORBIDDEN_IN_PRODUCTION`.

### Propósitos

| Propósito | Uso |
| --- | --- |
| `ContentApproval` | Aprobar contenido editorial |
| `Package` | Publicar un paquete fiscal |
| `RollbackAuthorization` | Autorizar una reversión |
| `TrustRoot` | Actualizar la raíz de confianza |

Las firmas están separadas por dominio: una firma válida para un propósito no se reutiliza para otro.

### Capacidades

| Capacidad | Uso |
| --- | --- |
| `Direct` | Cálculo bruto → neto |
| `Inverse` | Búsqueda neto → bruto |

Un paquete puede requerir una o ambas. La política compilada `current_2026()` admite inverso; `direct_only()` no.

## Modelo de confianza

El crate `crates/nomina-fiscal-package` es nativo y deliberadamente pequeño. No tiene dependencias de Tauri, SQL, red, activación, firma privada ni reloj implícito. Verifica; no confía.

### Claves raíz

- Exactamente **tres** claves raíz. El backend falla con `THREE_ROOT_KEYS_REQUIRED` si el conjunto no está completo.
- Umbral **2-de-3** para autorizar cambios de confianza.
- Se rechazan duplicados.
- Las claves raíz por sí solas no confieren autoridad operativa: se requiere metadata firmada vigente.
- El estado confiable (`TrustedState`) solo se construye desde el host. Nunca se deserializa desde un paquete ni desde IPC.

### Separación QA / producción

Las features `fiscal-import-qa` y `fiscal-production` son mutuamente excluyentes. `src-tauri/src/lib.rs` contiene un `compile_error!` que impide compilar ambas. La validación de entorno QA se ejecuta en `fiscal_import::host_context::validate_qa_environment`.

### Qué no confía el sistema

- No confía en el nombre del archivo.
- No confía en el manifiesto sin verificar su firma.
- No confía en una clave por estar presente.
- No confía en una revisión por ser más alta.
- No acepta un bootstrap de confianza desde el paquete.
- No acepta una firma de QA como si fuera de producción.

## Pipeline de verificación

La verificación es por etapas. Un fallo en una etapa no se compensa con éxito en otra.

```text
1. Formato y JSON estricto
2. Canonicalización RFC 8785
3. Integridad del contenedor y del payload
4. Autenticación de firmas
5. Aprobación editorial
6. Datos fiscales y esquema
7. Compatibilidad con el motor compilado
8. Revisión y estado de confianza
9. Reporte final
```

El reporte (`VerificationReport`) conserva, entre otros campos:

- `channel`
- `requested_operation`
- `stages`
- `authentication`
- `editorial_approval`
- `fiscal_data`
- `compatibility`
- `identities`
- `publishing_keys`
- `approval_keys`
- `root_version`
- `trust_epoch`
- `verified_at`
- `revision_status`
- `execution`

Identidades verificadas:

- `content`
- `signed_payload_sha256`
- `container_sha256`
- `motor_identity`

Un reporte de verificación no es una autorización de activación. La activación tiene su propio ciclo y su propia reconciliación.

## Compatibilidad con el motor

El paquete debe declarar que el motor compilado puede ejecutarlo. La comprobación no se basa solo en el número de versión.

Requisitos compilados para 2026:

| Requisito | Valor |
| --- | --- |
| Ejercicio | 2026 |
| Esquema de parámetros | `embedded-registry-2026-v1` |
| Perfil de reglas | `mx-standard-2026-contextual-v2` |
| Política contextual | `standard-isr-withholding-2026-independent-context-v2` |
| Convenciones | `standard-estimate-2026-v1` |

Si el paquete no satisface estos requisitos, la verificación falla con `REQUIRES_APPLICATION_UPDATE`. No se intenta “aproximar” compatibilidad ni ejecutar un paquete parcialmente compatible.

## Activación

La activación convierte un paquete verificado en una sesión utilizable. No es un simple “load”.

Características:

- Sesión con timeout absoluto de **300 s**.
- Timeout de inactividad de **120 s**.
- Nonce de preview.
- Fases: `ready`, `preparing`, `confirming`, `unknown`, `committed`, `rejected`, `expired`, `cancelled`.
- La confirmación es explícita.
- La reconciliación posterior se hace por replay independiente del repositorio, no por confianza en la respuesta de la UI.
- Una activación no reemplaza silenciosamente el paquete embebido.

La UI actual no monta este flujo. El código de backend y los comandos existen para una integración futura, pero no se presentan como función disponible.

## Repositorio y revisiones

El backend mantiene estado de revisiones y metadata de publicación. Los campos de publicación (`revision`, `stream_epoch`, `minimum_trust_epoch`) deben ser distintos de cero. La verificación conserva el estado de revisión y el epoch de confianza para que una activación posterior pueda reconciliarse.

Una revisión más nueva no se acepta automáticamente: debe superar el mismo pipeline y respetar el estado de confianza del host.

## Herramientas editoriales

`tools/fiscal-editorial/` contiene una CLI para construir y verificar paquetes. No forma parte del runtime de la aplicación.

Comandos:

```text
build
canonicalize
validate
hash
inspect
diff
sign-qa
verify
verify-independent
publication-report
```

Reglas operativas:

- Las claves de QA deben resolverse fuera del proyecto.
- Las claves raíz se mantienen en memoria.
- Los PEM temporales se eliminan.
- `sign-qa` no debe usarse para producción.
- `exercise.mjs --fiscal` ejecuta la regresión completa de Vitest después de comprobar que el registro histórico 2026 no cambió.

La CLI no está pensada para que un usuario final firme paquetes. Es una herramienta de desarrollo y operación editorial.

## Propiedades de seguridad

- Verificación nativa, sin red.
- Sin acceso general al sistema de archivos desde React.
- Sin SQL desde el frontend.
- Sin reloj implícito: el tiempo se pasa explícitamente.
- Sin claves privadas en el repositorio.
- Sin bootstrap de confianza desde el paquete.
- Sin reutilización de firmas entre dominios.
- Sin aceptación de claves QA en producción.
- Sin activación por el solo hecho de que el formato sea válido.
- Sin ejecución de paquetes incompatibles.

## Límites actuales

- No hay paquete de producción incluido.
- No hay descarga de años fiscales.
- No hay UI montada para importar o activar.
- Solo existe compatibilidad compilada para 2026.
- La revisión fiscal D1–D5 sigue pendiente.
- La aprobación editorial no sustituye la aprobación fiscal.
- La verificación técnica no certifica el contenido normativo.

## Mapa de código

- `crates/nomina-fiscal-package/src/lib.rs`: superficie del crate.
- `crates/nomina-fiscal-package/src/trust.rs`: claves raíz, QA/producción y estado confiable.
- `crates/nomina-fiscal-package/src/verify.rs`: pipeline y reporte.
- `crates/nomina-fiscal-package/src/compatibility.rs`: compatibilidad con el motor.
- `crates/nomina-fiscal-package/src/wire.rs`: DTOs del paquete.
- `crates/nomina-fiscal-package/src/canonical.rs`: canonicalización.
- `crates/nomina-fiscal-package/src/signature.rs`: firmas.
- `crates/nomina-fiscal-package/src/hashes.rs`: hashes.
- `crates/nomina-fiscal-package/src/strict_json.rs`: JSON estricto.
- `src-tauri/src/fiscal_import/`: importación y contexto del host.
- `src-tauri/src/fiscal_activation/`: sesiones de activación.
- `src-tauri/src/fiscal_execution/`: ejecución fiscal.
- `src-tauri/src/fiscal_repository/`: revisiones y estado.
- `src/features/fiscal-packages/`: UI y API del frontend, no montada.
- `tools/fiscal-editorial/`: CLI editorial.

La separación de capas y los límites de confianza se explican en [ARQUITECTURA.md](ARQUITECTURA.md).
