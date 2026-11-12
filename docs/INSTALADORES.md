# Instaladores

Este documento reúne los datos verificables del candidato Windows `0.1.1-rc.1`, los requisitos de instalación, la ruta de datos y los bloqueos que impiden presentarlo como release oficial. **El repositorio no incluye binarios.**

## Estado

| Dato | Valor |
| --- | --- |
| Versión | `0.1.1-rc.1` |
| Plataforma | Windows x64 |
| Empaquetado | NSIS por usuario |
| Firma Authenticode | **NotSigned** |
| Instalación limpia | **NOT RUN** |
| Actualización 0.1.0 → 0.1.1-rc.1 | **PASS** |
| Aprobación fiscal D1–D5 | **PENDING** |
| Distribución general | **NO-GO** |

El candidato sirve para validación local controlada. No debe publicarse como release general mientras siga sin firma, sin prueba en Windows limpio y sin aprobación fiscal.

## Artefactos

### Instalador compacto

| Dato | Valor |
| --- | --- |
| Archivo | `CalculadoraNomina_0.1.1-rc.1_x64-setup.exe` |
| Tamaño | 6,922,120 bytes |
| SHA-256 | `3c0f5738446b6c79a68e34c9425a53ed9c80649408b9d2165de0b3905419e7ac` |
| WebView2 | `embedBootstrapper`; descarga el runtime si falta |
| Requiere internet | Solo si WebView2 no está presente |

### Instalador offline

| Dato | Valor |
| --- | --- |
| Archivo | `CalculadoraNomina_0.1.1-rc.1_offline_x64-setup.exe` |
| Tamaño | 222,910,288 bytes (212.58 MiB) |
| SHA-256 | `6e049470e1dc1cfd2814f1eeb81f9143e7a32c941db5b9897dc9793c3ff8fbbe` |
| WebView2 | `offlineInstaller` embebido |
| Requiere internet | No para instalar ni calcular |

El instalador offline usa la misma fuente y versión que el compacto, pero es un artefacto distinto. No se le atribuyen automáticamente los PASS de actualización del candidato compacto.

### Referencia 0.1.0

```text
Calculadora de Nómina_0.1.0_x64-setup.exe
SHA-256 146cb6bdf9ae121846c15d692e5a5594b5b89433d2e4aeadb0809ea3bfde7f2a
```

No se sobrescribió. No se debe volver a instalar 0.1.0 después de guardar documentos con el productor nuevo: el lector antiguo no conoce el nuevo productor documental.

## Requisitos

- Windows 11 x64 como plataforma validada.
- Cuenta de usuario estándar.
- Microsoft Edge WebView2 Evergreen Runtime.
- Pantalla que permita una ventana de al menos 900 × 600 unidades lógicas.
- No requiere Node, Rust, OpenCode ni servidor de desarrollo para usar la aplicación.

Validado en este equipo:

- Windows 11 Pro x64, build 10.0.26200.
- WebView2 Runtime 156.0.4314.58.
- Escala Windows 125 %.

No validado:

- Windows 10.
- Windows 11 ARM64 u otras builds.
- Instalación en una máquina limpia sin WebView2.
- Instalación en una máquina limpia con WebView2 ausente y sin internet.

## Instalación

1. Cierra la calculadora si está abierta.
2. Verifica el SHA-256 del archivo.
3. Ejecuta el instalador y sigue el asistente para el usuario actual.
4. Abre **Calculadora de Nómina** desde Inicio.
5. Windows puede mostrar SmartScreen o “editor desconocido” porque el archivo no está firmado.

Verificación del hash:

```powershell
Get-FileHash -LiteralPath ".\CalculadoraNomina_0.1.1-rc.1_x64-setup.exe" -Algorithm SHA256
```

El resultado debe coincidir exactamente con el hash publicado.

## Actualización

La actualización real `0.1.0 → 0.1.1-rc.1` fue **PASS** sobre una instalación preparada. No sustituye una prueba en Windows limpio.

Para actualizar:

1. Cierra la calculadora.
2. Conserva el usuario y la carpeta de instalación.
3. No borres los datos de aplicación.
4. Ejecuta el instalador nuevo.
5. Abre la aplicación y comprueba que el historial y las preferencias siguen disponibles.

No se debe volver a 0.1.0 después de crear documentos con el productor nuevo.

## Datos y privacidad

| Dato | Ruta |
| --- | --- |
| Historial y preferencias | `%LOCALAPPDATA%\mx.calculadoranomina.desktop\payroll.sqlite3` |
| PDF | Carpeta elegida por el usuario en el diálogo de guardado |

- La base local **no está cifrada**.
- En un perfil nuevo, el guardado automático empieza desactivado.
- Una actualización conserva la preferencia existente.
- Desactivar el guardado automático no borra registros.
- Para probar cifras sin agregar documentos al historial, desactiva el guardado automático.
- Los PDF se generan localmente; las fuentes están embebidas.
- No se observaron solicitudes externas en los flujos verificados. No es una auditoría absoluta de la telemetría del sistema operativo o de WebView2.

## Desinstalación

Para desinstalar conservando el historial, deja **sin marcar** “Eliminar los datos de aplicación”.

Para eliminar también la base local, marca esa opción. La desinstalación no modifica los PDF que ya hayas guardado en tus carpetas.

## Construcción

Requisitos de desarrollo:

- Node.js y npm.
- Rust con destino `x86_64-pc-windows-msvc`.
- Visual Studio Build Tools con herramientas de C++ y Windows SDK.
- WebView2 Runtime.

Instalación de dependencias:

```powershell
npm install
```

Build del frontend:

```powershell
npm run build
```

Instalador compacto:

```powershell
npm run tauri -- build --config src-tauri/tauri.release.conf.json --bundles nsis --no-sign --ci -- --locked --offline --no-default-features
```

Instalador offline:

```powershell
npm run tauri -- build --config src-tauri/tauri.offline.conf.json --bundles nsis --no-sign --ci -- --locked --offline --no-default-features
```

La configuración offline cambia únicamente el modo de WebView2 a `offlineInstaller`. No modifica el motor, las fórmulas, las tablas ni los productores documentales.

## Validación del candidato

| Comprobación | Resultado |
| --- | --- |
| Compilación release | PASS |
| Empaquetado NSIS | PASS |
| Hash y tamaño | Verificados |
| Actualización real desde 0.1.0 | PASS |
| Instalación limpia | NOT RUN |
| Arranque sin WebView2 | NOT RUN |
| Firma Authenticode | NotSigned |
| Revisión fiscal | PENDING |

La instalación limpia no se ejecutó porque este equipo no dispone de Windows Sandbox, Hyper-V, VirtualBox, VMware ni QEMU utilizables. No se usó el perfil personal como sustituto de una máquina limpia.

## Bloqueos para publicación general

1. **Firma Authenticode:** no hay certificado de firma con clave privada disponible. SmartScreen puede advertir y no existe una identidad de editor verificable por Windows.
2. **Instalación limpia:** no ejecutada. Debe completarse o aceptarse el riesgo residual por escrito.
3. **Aprobación fiscal D1–D5:** pendiente. La firma del instalador no certifica los cálculos.
4. **WebView2 sin internet:** el instalador compacto no promete instalación si falta el runtime y no hay conexión. La variante offline resuelve el empaquetado, pero su instalación limpia tampoco se probó.
5. **Aceptación final del propietario:** pendiente.

## Qué no debe afirmarse

- Que el instalador está firmado.
- Que la instalación limpia fue aprobada.
- Que el candidato es un release oficial.
- Que los cálculos están certificados fiscalmente.
- Que la base local está cifrada.
- Que el instalador compacto funciona sin internet si WebView2 no está instalado.
- Que el instalador offline fue probado en una máquina limpia.

## Evidencia

La evidencia detallada de distribución, actualización, hashes y límites se conserva en los documentos históricos del proyecto. Para el repositorio público se mantienen este resumen y los hashes; los binarios y la evidencia pesada quedan fuera del árbol publicable.

Consulta también [ARQUITECTURA.md](ARQUITECTURA.md) y [PAQUETES-FISCALES.md](PAQUETES-FISCALES.md).
